import { Job } from '../queue'
import UserDeviceJob from '../users/UserDeviceJob'
import EventPostJob from '../client/EventPostJob'
import { getCampaign, getCampaignSend, sendCampaignJob, triggerCampaignSend } from './CampaignService'
import Campaign, { CampaignSend } from './Campaign'
import { User } from '../users/User'
import { UserEvent } from '../users/UserEvent'
import { getUserFromClientId } from '../users/UserRepository'
import { getCampaignTriggerEvent } from '../users/UserEventRepository'
import { logger } from '../config/logger'
import { uuid } from '../utilities'

export interface CampaignTriggerSendParams {
    project_id: number
    campaign_id: number
    reference_id: string
    user: Pick<User, 'email' | 'phone' | 'timezone' | 'locale'> & { external_id: string, device_token?: string }
    event: Record<string, any>
}

// A send already exists for this reference: either it is done, or it is
// still waiting and its email job may have been lost, so queue it again
// with the event it was created from (same job id, so BullMQ dedupes and
// the hasCompleted guard and send lock prevent a second delivery)
const resumeSend = async (campaign: Campaign, userId: number, send: CampaignSend, reference_id: string) => {
    if (send.hasCompleted) {
        logger.info({ campaignId: campaign.id, userId, reference_id, state: send.state }, 'campaign:trigger:duplicate')
        return
    }

    const event = await getCampaignTriggerEvent(campaign.id, userId, reference_id)
    if (!event) {
        throw new Error(`campaign:trigger:missing_event campaign=${campaign.id} user=${userId} reference=${reference_id}`)
    }

    await sendCampaignJob({
        campaign,
        user: userId,
        event: event.id,
        reference_type: 'trigger',
        reference_id,
    }).queue()
}

export default class CampaignTriggerSendJob extends Job {
    static $name = 'campaign_trigger_send_job'

    // Recovery after a failed inner enqueue relies on BullMQ retrying this job
    options = {
        delay: 0,
        attempts: 8,
    }

    static from(data: CampaignTriggerSendParams): CampaignTriggerSendJob {
        return new this(data).jobId(`trigger_${data.campaign_id}_${data.reference_id}`)
    }

    // Jobs queued before YN-10996 carry no reference
    static async handler({ project_id, campaign_id, reference_id: incoming, user, event }: Omit<CampaignTriggerSendParams, 'reference_id'> & { reference_id?: string }) {
        const reference_id = incoming ?? uuid()
        const { external_id, email, phone, device_token, locale, timezone, ...data } = user

        const campaign = await getCampaign(campaign_id, project_id)
        if (!campaign) return

        const existingUser = await getUserFromClientId(project_id, { external_id })
        const existingSend = existingUser && await getCampaignSend(campaign_id, existingUser.id, reference_id)
        if (existingUser && existingSend) {
            return await resumeSend(campaign, existingUser.id, existingSend, reference_id)
        }

        const { user: { id: userId }, event: { id: eventId } } = await EventPostJob.from({
            project_id,
            event: {
                name: 'campaign_trigger',
                external_id: user.external_id,
                data: {
                    ...event,
                    campaign: { id: campaign_id, name: campaign.name, reference_id },
                },
                user: { external_id, email, phone, data, locale, timezone },
            },
        }).handle<{ user: User, event: UserEvent }>()

        if (device_token) {
            await UserDeviceJob.from({
                project_id,
                external_id,
                token: device_token,
                device_id: device_token,
            }).handle()
        }

        const job = await triggerCampaignSend({
            campaign,
            user: userId,
            reference_id,
            reference_type: 'trigger',
            event: eventId,
            idempotent: true,
        })
        await job?.queue()
    }
}
