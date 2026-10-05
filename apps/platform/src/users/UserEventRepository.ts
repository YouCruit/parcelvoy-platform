import { PageParams } from '../core/searchParams'
import { loadAnalytics } from '../providers/analytics'
import { User } from '../users/User'
import { UserEvent, UserEventParams } from './UserEvent'

export const createEvent = async (
    user: User,
    { name, data }: UserEventParams,
    forward = true,
    filter = (data: Record<string, unknown>) => data,
): Promise<number> => {
    const id = await UserEvent.insert({
        name,
        data,
        project_id: user.project_id,
        user_id: user.id,
    })

    if (forward) {
        const analytics = await loadAnalytics(user.project_id)
        analytics.track({
            external_id: user.external_id,
            anonymous_id: user.anonymous_id,
            name,
            data: filter(data),
        })
    }
    return id
}

export const createAndFetchEvent = async (user: User, event: UserEventParams, forward = false): Promise<UserEvent> => {
    const id = await createEvent(user, event, forward)
    const userEvent = await UserEvent.find(id)
    return userEvent!
}

export const getUserEvents = async (id: number, params: PageParams, projectId: number) => {
    return await UserEvent.search(
        { ...params, fields: ['name'] },
        b => b.where('project_id', projectId)
            .where('user_id', id)
            .orderBy('id', 'desc'),
    )
}

// The campaign_trigger event a trigger send was created from. The trigger
// job stamps `data.campaign.{id,reference_id}`, so a re-queued send can
// render the original event instead of none. Scoped by campaign because a
// caller may reuse one reference across campaigns for the same user
export const getCampaignTriggerEvent = async (campaignId: number, userId: number, referenceId: string): Promise<UserEvent | undefined> => {
    return await UserEvent.first(qb => qb
        .where('name', 'campaign_trigger')
        .where('user_id', userId)
        .whereRaw('JSON_EXTRACT(data, \'$.campaign.id\') = ?', [campaignId])
        .whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, \'$.campaign.reference_id\')) = ?', [referenceId])
        .orderBy('id', 'desc'),
    )
}
