import supertest from 'supertest'
import Api from '../../api'
import App from '../../app'
import { createProjectApiKey } from '../ProjectService'
import { createTestProject } from './ProjectTestHelpers'
import { uuid } from '../../utilities'

afterEach(() => {
    jest.restoreAllMocks()
})

describe('POST /data/paths/sync', () => {

    const sync = async () => {
        const api = new Api(App.main)
        const project = await createTestProject()
        const apiKey = await createProjectApiKey(project.id, { scope: 'secret', name: uuid(), role: 'admin' })
        return supertest(api.callback())
            .post('/api/client/data/paths/sync')
            .set('Authorization', `Bearer ${apiKey.value}`)
            .send()
    }

    test('answers 204 when the enqueue succeeds', async () => {
        const enqueue = jest.spyOn(App.main.queue, 'enqueue').mockResolvedValue()

        const response = await sync()

        expect(response.status).toBe(204)
        expect(enqueue).toHaveBeenCalledTimes(1)
    })

    // 400 is the generic error mapping; a 403 here would mean the scope
    // check rejected the request before the handler ran
    test('answers 400, not 204, when the enqueue fails', async () => {
        jest.spyOn(App.main.queue, 'enqueue').mockRejectedValue(new Error('redis down'))

        const response = await sync()

        expect(response.status).toBe(400)
    })
})
