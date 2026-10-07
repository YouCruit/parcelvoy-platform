import App from '../../app'
import Project from '../../projects/Project'
import Journey from '../Journey'
import JourneyDelayJob from '../JourneyDelayJob'
import UpdateJourneysJob from '../UpdateJourneysJob'

afterEach(() => {
    jest.restoreAllMocks()
})

const publishedJourney = async () => {
    const project = await Project.insertAndFetch({ name: `enqueue failure ${Date.now()}` })
    await Journey.insert({ project_id: project.id, name: 'enqueue failure', published: true })
}

describe('journey jobs surface enqueue failures', () => {

    test('JourneyDelayJob.enqueueActive rejects when enqueueBatch rejects', async () => {
        await publishedJourney()
        const error = new Error('redis down')
        jest.spyOn(App.main.queue, 'enqueueBatch').mockRejectedValue(error)

        await expect(JourneyDelayJob.enqueueActive(App.main)).rejects.toBe(error)
    })

    test('UpdateJourneysJob.handler rejects when enqueueBatch rejects', async () => {
        await publishedJourney()
        const error = new Error('redis down')
        jest.spyOn(App.main.queue, 'enqueueBatch').mockRejectedValue(error)

        await expect(UpdateJourneysJob.handler()).rejects.toBe(error)
    })
})
