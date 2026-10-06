import App from '../../app'
import { createTestProject } from '../../projects/__tests__/ProjectTestHelpers'
import { createProvider } from '../../providers/ProviderRepository'
import EmailJob from '../../providers/email/EmailJob'
import { EncodedJob } from '../../queue'
import { createSubscription } from '../../subscriptions/SubscriptionService'
import { UserEvent } from '../../users/UserEvent'
import { getUserFromClientId } from '../../users/UserRepository'
import { uuid } from '../../utilities'
import { logger } from '../../config/logger'
import Campaign, { CampaignSend, CampaignSendState } from '../Campaign'
import { createCampaign } from '../CampaignService'
import CampaignTriggerSendJob, { CampaignTriggerSendParams } from '../CampaignTriggerSendJob'

afterEach(() => {
    jest.restoreAllMocks()
})

const createTriggerCampaign = async (): Promise<Campaign> => {
    const project = await createTestProject()
    const subscription = await createSubscription(project.id, { name: uuid(), channel: 'email' })
    const provider = await createProvider(project.id, {
        type: 'smtp',
        group: 'email',
        data: {},
        name: uuid(),
        is_default: false,
        rate_limit: 10,
        rate_interval: 'second',
    })
    return await createCampaign(project.id, {
        name: uuid(),
        type: 'trigger',
        channel: 'email',
        subscription_id: subscription.id,
        provider_id: provider.id,
    })
}

const params = (campaign: Campaign, reference_id: string, external_id = uuid()): CampaignTriggerSendParams => ({
    project_id: campaign.project_id,
    campaign_id: campaign.id,
    reference_id,
    user: { external_id, email: `${external_id}@test.com` },
    event: { token: 'abc' },
})

// Captures queued EmailJobs without touching a real queue. Other jobs
// (e.g. from UserPatchJob) are swallowed. `failEmailOnce` makes the first
// EmailJob enqueue reject, as a Redis blip would.
const captureQueue = (failEmailOnce = false) => {
    const emails: EncodedJob[] = []
    let alreadyFailed = !failEmailOnce
    jest.spyOn(App.main.queue, 'enqueue').mockImplementation(async job => {
        if (!(job instanceof EmailJob)) return
        if (!alreadyFailed) {
            alreadyFailed = true
            throw new Error('redis down')
        }
        emails.push(job)
    })
    return emails
}

const loadState = async (campaign: Campaign, external_id: string) => {
    const user = await getUserFromClientId(campaign.project_id, { external_id })
    const rows = await CampaignSend.all(qb => qb.where('campaign_id', campaign.id).where('user_id', user!.id))
    const events = await UserEvent.all(qb => qb.where('user_id', user!.id).where('name', 'campaign_trigger'))
    return { user: user!, rows, events }
}

describe('CampaignTriggerSendJob', () => {

    test('from() derives the outer job id from the user and the reference', () => {
        const job = CampaignTriggerSendJob.from({
            project_id: 1, campaign_id: 2, reference_id: 'ref-1', user: { external_id: 'x' }, event: {},
        })
        // sha256('x'), first 16 hex characters
        expect(job.options.jobId).toEqual('trigger_2_2d711642b726b044_ref-1')
        expect(job.options.attempts).toEqual(8)
        expect(job.options.removeOnFail).toBe(true)
    })

    test('from() gives each recipient of a shared reference its own job id', () => {
        const from = (external_id: string) => CampaignTriggerSendJob.from({
            project_id: 1, campaign_id: 2, reference_id: 'ref-1', user: { external_id }, event: {},
        }).options.jobId

        expect(from('a')).not.toEqual(from('b'))
        expect(from('a')).toEqual(from('a'))
    })

    test('first run creates one row, one stamped event and one email job', async () => {
        const campaign = await createTriggerCampaign()
        const emails = captureQueue()
        const reference_id = uuid()
        const payload = params(campaign, reference_id)

        await CampaignTriggerSendJob.handler(payload)

        const { user, rows, events } = await loadState(campaign, payload.user.external_id)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ state: 'pending', reference_id, reference_type: 'trigger' })
        expect(events).toHaveLength(1)
        expect(events[0].data).toMatchObject({ token: 'abc', campaign: { id: campaign.id, reference_id } })
        expect(emails).toHaveLength(1)
        expect(emails[0].options.jobId).toEqual(`sid_${campaign.id}_${user.id}_${reference_id}`)
        expect(emails[0].data.event_id).toEqual(events[0].id)
    })

    test('a job queued without a reference (older image) still sends once', async () => {
        const campaign = await createTriggerCampaign()
        const emails = captureQueue()
        const payload = { ...params(campaign, 'unused'), reference_id: undefined }

        await CampaignTriggerSendJob.handler(payload as any)

        const { rows, events } = await loadState(campaign, payload.user.external_id)
        expect(rows).toHaveLength(1)
        expect(rows[0].reference_id).toMatch(/^[0-9a-f-]{36}$/)
        expect(events).toHaveLength(1)
        expect(emails).toHaveLength(1)
    })

    test.each<CampaignSendState>(['pending', 'throttled'])('repeat while %s re-queues with the original event', async (state) => {
        const campaign = await createTriggerCampaign()
        const reference_id = uuid()
        const payload = params(campaign, reference_id)
        captureQueue()
        await CampaignTriggerSendJob.handler(payload)
        const before = await loadState(campaign, payload.user.external_id)
        await CampaignSend.update(qb => qb.where('campaign_id', campaign.id).where('user_id', before.user.id), { state })

        jest.restoreAllMocks()
        const emails = captureQueue()
        await CampaignTriggerSendJob.handler(payload)

        const after = await loadState(campaign, payload.user.external_id)
        expect(after.rows).toHaveLength(1)
        expect(after.events).toHaveLength(1)
        expect(emails).toHaveLength(1)
        expect(emails[0].options.jobId).toEqual(`sid_${campaign.id}_${before.user.id}_${reference_id}`)
        expect(emails[0].data.event_id).toEqual(before.events[0].id)
    })

    test.each<CampaignSendState>(['sent', 'aborted', 'failed', 'bounced'])('repeat while %s does nothing', async (state) => {
        const campaign = await createTriggerCampaign()
        const payload = params(campaign, uuid())
        captureQueue()
        await CampaignTriggerSendJob.handler(payload)
        const before = await loadState(campaign, payload.user.external_id)
        await CampaignSend.update(qb => qb.where('campaign_id', campaign.id).where('user_id', before.user.id), { state })

        jest.restoreAllMocks()
        const emails = captureQueue()
        const info = jest.spyOn(logger, 'info')
        await CampaignTriggerSendJob.handler(payload)

        const after = await loadState(campaign, payload.user.external_id)
        expect(after.rows).toHaveLength(1)
        expect(after.events).toHaveLength(1)
        expect(emails).toHaveLength(0)
        expect(info).toHaveBeenCalledWith(
            expect.objectContaining({ campaignId: campaign.id, reference_id: payload.reference_id, state }),
            'campaign:trigger:duplicate',
        )
    })

    test('recovery renders the original event, not a later one with the same reference', async () => {
        const campaign = await createTriggerCampaign()
        const reference_id = uuid()
        const payload = params(campaign, reference_id)
        captureQueue()
        await CampaignTriggerSendJob.handler(payload)
        const before = await loadState(campaign, payload.user.external_id)
        await UserEvent.insert({
            name: 'campaign_trigger',
            project_id: campaign.project_id,
            user_id: before.user.id,
            data: { token: 'planted', campaign: { id: campaign.id, reference_id } },
        })

        jest.restoreAllMocks()
        const emails = captureQueue()
        await CampaignTriggerSendJob.handler(payload)

        const after = await loadState(campaign, payload.user.external_id)
        expect(after.events).toHaveLength(2)
        expect(emails).toHaveLength(1)
        expect(emails[0].data.event_id).toEqual(before.events[0].id)
    })

    test('repeat while pending with its event deleted fails loudly', async () => {
        const campaign = await createTriggerCampaign()
        const payload = params(campaign, uuid())
        captureQueue()
        await CampaignTriggerSendJob.handler(payload)
        const before = await loadState(campaign, payload.user.external_id)
        await UserEvent.delete(qb => qb.where('id', before.events[0].id))

        jest.restoreAllMocks()
        const emails = captureQueue()
        await expect(CampaignTriggerSendJob.handler(payload)).rejects.toThrow(/^campaign:trigger:missing_event/)
        expect(emails).toHaveLength(0)
    })

    test('failed inner enqueue fails the job; the retry sends once with the original event', async () => {
        const campaign = await createTriggerCampaign()
        const reference_id = uuid()
        const payload = params(campaign, reference_id)
        const emails = captureQueue(true)

        await expect(CampaignTriggerSendJob.handler(payload)).rejects.toThrow('redis down')
        await CampaignTriggerSendJob.handler(payload)

        const { user, rows, events } = await loadState(campaign, payload.user.external_id)
        expect(rows).toHaveLength(1)
        expect(events).toHaveLength(1)
        expect(emails).toHaveLength(1)
        expect(emails[0].options.jobId).toEqual(`sid_${campaign.id}_${user.id}_${reference_id}`)
        expect(emails[0].data.event_id).toEqual(events[0].id)
    })

    test('the same reference on two campaigns recovers each campaign\'s own event', async () => {
        const first = await createTriggerCampaign()
        const second = await createCampaign(first.project_id, {
            name: uuid(),
            type: 'trigger',
            channel: 'email',
            subscription_id: first.subscription_id,
            provider_id: first.provider_id,
        })
        const external_id = uuid()
        const reference_id = uuid()
        captureQueue()
        await CampaignTriggerSendJob.handler(params(first, reference_id, external_id))
        await CampaignTriggerSendJob.handler(params(second, reference_id, external_id))
        const a = await loadState(first, external_id)
        const b = await loadState(second, external_id)
        const eventFor = (campaign: Campaign) => a.events.find(e => (e.data.campaign as { id: number }).id === campaign.id)!

        jest.restoreAllMocks()
        const emails = captureQueue()
        await CampaignTriggerSendJob.handler(params(first, reference_id, external_id))
        await CampaignTriggerSendJob.handler(params(second, reference_id, external_id))

        expect(a.events).toHaveLength(2)
        expect(b.rows).toHaveLength(1)
        expect(emails).toHaveLength(2)
        expect(emails[0].data.campaign_id).toEqual(first.id)
        expect(emails[0].data.event_id).toEqual(eventFor(first).id)
        expect(emails[1].data.campaign_id).toEqual(second.id)
        expect(emails[1].data.event_id).toEqual(eventFor(second).id)
    })

    test('different references are different sends', async () => {
        const campaign = await createTriggerCampaign()
        const external_id = uuid()
        const emails = captureQueue()

        await CampaignTriggerSendJob.handler(params(campaign, uuid(), external_id))
        await CampaignTriggerSendJob.handler(params(campaign, uuid(), external_id))

        const { rows, events } = await loadState(campaign, external_id)
        expect(rows).toHaveLength(2)
        expect(events).toHaveLength(2)
        expect(emails).toHaveLength(2)
    })
})
