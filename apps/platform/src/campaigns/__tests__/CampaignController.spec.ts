import supertest from 'supertest'
import Api from '../../api'
import App from '../../app'
import { createProjectApiKey } from '../../projects/ProjectService'
import { createTestProject } from '../../projects/__tests__/ProjectTestHelpers'
import { createProvider } from '../../providers/ProviderRepository'
import { createSubscription } from '../../subscriptions/SubscriptionService'
import { uuid } from '../../utilities'
import { createCampaign } from '../CampaignService'
import CampaignTriggerSendJob from '../CampaignTriggerSendJob'

afterEach(() => {
    jest.restoreAllMocks()
})

const setup = async () => {
    const api = new Api(App.main)
    const project = await createTestProject()
    const apiKey = await createProjectApiKey(project.id, {
        scope: 'secret',
        name: uuid(),
        role: 'admin',
    })
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
    const campaign = await createCampaign(project.id, {
        name: uuid(),
        type: 'trigger',
        channel: 'email',
        subscription_id: subscription.id,
        provider_id: provider.id,
    })
    const trigger = (body: Record<string, unknown>) => supertest(api.callback())
        .post(`/api/client/campaigns/${campaign.id}/trigger`)
        .set('Authorization', `Bearer ${apiKey.value}`)
        .send(body)
    return { campaign, trigger }
}

const body = (extra: Record<string, unknown> = {}) => ({
    user: { external_id: uuid(), email: `${uuid()}@test.com` },
    event: { token: 'abc' },
    ...extra,
})

const triggerJobs = (spy: jest.SpyInstance) => spy.mock.calls
    .map(([job]) => job)
    .filter(job => job instanceof CampaignTriggerSendJob)

describe('POST /campaigns/:campaignId/trigger', () => {

    test('uses the caller reference for the outer job', async () => {
        const { campaign, trigger } = await setup()
        const spy = jest.spyOn(App.main.queue, 'enqueue').mockResolvedValue()

        const response = await trigger(body({ reference_id: 'ref-1' }))

        expect(response.status).toBe(200)
        expect(response.body).toEqual({ success: true })
        const jobs = triggerJobs(spy)
        expect(jobs).toHaveLength(1)
        expect(jobs[0].data.reference_id).toEqual('ref-1')
        expect(jobs[0].options.jobId).toEqual(`trigger_${campaign.id}_ref-1`)
    })

    test('mints a reference when the caller sends none', async () => {
        const { campaign, trigger } = await setup()
        const spy = jest.spyOn(App.main.queue, 'enqueue').mockResolvedValue()

        const response = await trigger(body())

        expect(response.status).toBe(200)
        const [job] = triggerJobs(spy)
        expect(job.data.reference_id).toMatch(/^[0-9a-f-]{36}$/)
        expect(job.options.jobId).toEqual(`trigger_${campaign.id}_${job.data.reference_id}`)
    })

    test.each([
        ['an empty reference', { reference_id: '' }],
        ['an unknown field', { surprise: true }],
    ])('rejects %s without queueing', async (_, extra) => {
        const { trigger } = await setup()
        const spy = jest.spyOn(App.main.queue, 'enqueue').mockResolvedValue()

        const response = await trigger(body(extra))

        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(response.status).toBeLessThan(500)
        expect(triggerJobs(spy)).toHaveLength(0)
    })

    test('answers 503 when the enqueue fails', async () => {
        const { trigger } = await setup()
        jest.spyOn(App.main.queue, 'enqueue').mockRejectedValue(new Error('redis down'))

        const response = await trigger(body({ reference_id: 'ref-2' }))

        expect(response.status).toBe(503)
        expect(response.body.error).toEqual('Unable to queue trigger')
    })
})
