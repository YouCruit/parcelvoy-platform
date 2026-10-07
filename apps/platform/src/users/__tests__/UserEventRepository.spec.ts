import { createTestProject } from '../../projects/__tests__/ProjectTestHelpers'
import { uuid } from '../../utilities'
import { UserEvent } from '../UserEvent'
import { getCampaignTriggerEvent } from '../UserEventRepository'
import { createUser } from '../UserRepository'

describe('getCampaignTriggerEvent', () => {
    test('ignores an older event whose name only matches under the collation', async () => {
        const project = await createTestProject()
        const user = await createUser(project.id, { external_id: uuid(), anonymous_id: uuid() })
        const data = { campaign: { id: 1, reference_id: 'ref-a' } }
        const insert = (name: string) => UserEvent.insert({ name, data, project_id: project.id, user_id: user.id })

        await insert('Campaign_Trigger')
        const genuine = await insert('campaign_trigger')

        const event = await getCampaignTriggerEvent(1, user.id, 'ref-a')

        expect(event?.id).toEqual(genuine)
    })
})
