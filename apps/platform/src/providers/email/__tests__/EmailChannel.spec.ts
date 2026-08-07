import Admin from '../../../auth/Admin'
import { createProject } from '../../../projects/ProjectService'
import { Variables } from '../../../render'
import { createUser } from '../../../users/UserRepository'
import { encodeHashid, uuid } from '../../../utilities'
import EmailChannel from '../EmailChannel'
import LoggerEmailProvider from '../LoggerEmailProvider'

describe('EmailChannel', () => {

    const setup = async (data?: Record<string, any>): Promise<Variables> => {
        const admin = await Admin.insertAndFetch({
            first_name: uuid(),
            last_name: uuid(),
            email: `${uuid()}@test.com`,
        })
        const project = await createProject(admin, {
            name: uuid(),
            timezone: 'utc',
            locale: 'en',
        })
        const user = await createUser(project.id, {
            anonymous_id: uuid(),
            external_id: uuid(),
            data,
        })

        return {
            user,
            context: {
                template_id: 1,
                campaign_id: 1,
                subscription_id: 1,
                reference_id: 'ref-1',
            },
            project,
        }
    }

    describe('buildHeaders', () => {

        // These five headers are the join key the email-bridge uses to
        // correlate delivery and engagement events back to the campaign and
        // subscriber that produced them. Dropping or renaming one silently
        // orphans every event for those sends — the bridge logs "no correlation
        // row" and discards them — so they are pinned here rather than left to
        // be verified by reading the bridge's source in another repository.
        test('stamps the correlation headers the bridge joins events on', async () => {
            const variables = await setup()
            const channel = new EmailChannel(new LoggerEmailProvider())

            const headers = channel.buildHeaders(variables)

            expect(headers['X-Campaign-Id']).toEqual(encodeHashid(1))
            expect(headers['X-Subscription-Id']).toEqual(encodeHashid(1))
            expect(headers['X-External-Id']).toEqual(variables.user.external_id)
            expect(headers['X-Reference-Id']).toEqual('ref-1')
            expect(headers['X-Subscription-Id-Raw']).toEqual('1')
        })

        // The bridge parses X-Subscription-Id-Raw with strconv.Atoi and treats a
        // parse failure as subscription 0, which makes an unsubscribe
        // unsyncable. It must therefore always be the plain decimal id, never
        // the hashid that X-Subscription-Id carries.
        test('sends the subscription id both hashed and raw', async () => {
            const variables = await setup()
            const channel = new EmailChannel(new LoggerEmailProvider())

            const headers = channel.buildHeaders(variables)

            expect(headers['X-Subscription-Id-Raw']).toEqual('1')
            expect(headers['X-Subscription-Id']).not.toEqual('1')
        })

        // A user with no external_id must yield an empty header rather than the
        // string "undefined", which the bridge would store verbatim as a
        // correlation id and then fail to match against Parcelvoy.
        test('an absent external id yields an empty header, not "undefined"', async () => {
            const variables = await setup()
            variables.user.external_id = undefined as any
            const channel = new EmailChannel(new LoggerEmailProvider())

            const headers = channel.buildHeaders(variables)

            expect(headers['X-External-Id']).toEqual('')
        })
    })
})
