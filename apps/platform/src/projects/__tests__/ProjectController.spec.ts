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

    test('answers an error, not 204, when the enqueue fails', async () => {
        const api = new Api(App.main)
        const project = await createTestProject()
        const apiKey = await createProjectApiKey(project.id, { scope: 'secret', name: uuid(), role: 'admin' })
        jest.spyOn(App.main.queue, 'enqueue').mockRejectedValue(new Error('redis down'))

        const response = await supertest(api.callback())
            .post('/api/client/data/paths/sync')
            .set('Authorization', `Bearer ${apiKey.value}`)
            .send()

        expect(response.status).toBeGreaterThanOrEqual(400)
    })
})
