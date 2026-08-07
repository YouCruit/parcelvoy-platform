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

    describe('buildHeaders carrier identity', () => {

        // The bridge resolves, or creates, the Close CRM lead from these two.
        // caretaker syncs dot_number as an integer, so the header must be
        // stringified — the bridge validates it as digits-only and drops
        // anything else, treating the send as unattributable.
        test('stamps the carrier DOT and company name when the user has them', async () => {
            const variables = await setup({ dot_number: 1234567, company_name: 'ACME Trucking LLC' })
            const channel = new EmailChannel(new LoggerEmailProvider())

            const headers = channel.buildHeaders(variables)

            expect(headers['X-Dot-Number']).toEqual('1234567')
            expect(headers['X-Company-Name']).toEqual('ACME Trucking LLC')
        })

        // Most Parcelvoy users are drivers, not carriers, and carry neither
        // field. Omitting the headers rather than sending them blank keeps the
        // wire clean and matches how the bridge reads a missing DOT anyway.
        test('omits both headers when the user has no carrier data', async () => {
            const variables = await setup()
            const channel = new EmailChannel(new LoggerEmailProvider())

            const headers = channel.buildHeaders(variables)

            expect(headers).not.toHaveProperty('X-Dot-Number')
            expect(headers).not.toHaveProperty('X-Company-Name')
        })

        // The case a naive `'dot_number' in data` check gets wrong: the keys are
        // present but empty. An empty header is worse than no header — the
        // bridge would still see the field and log an unusable value rather
        // than cleanly recording the send as unmapped.
        test('omits both headers when the carrier fields are empty strings', async () => {
            const variables = await setup({ dot_number: '', company_name: '' })
            const channel = new EmailChannel(new LoggerEmailProvider())

            const headers = channel.buildHeaders(variables)

            expect(headers).not.toHaveProperty('X-Dot-Number')
            expect(headers).not.toHaveProperty('X-Company-Name')
        })

        // Each field is independent — a carrier known by DOT but with no name
        // on file must still get its DOT stamped, or the bridge cannot attach
        // the send to the lead it already has.
        test('stamps each carrier field independently of the other', async () => {
            const variables = await setup({ dot_number: 7654321 })
            const channel = new EmailChannel(new LoggerEmailProvider())

            const headers = channel.buildHeaders(variables)

            expect(headers['X-Dot-Number']).toEqual('7654321')
            expect(headers).not.toHaveProperty('X-Company-Name')
        })
    })
})
