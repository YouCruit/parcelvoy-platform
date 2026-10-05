import App from '../../app'
import { notifyJourney } from '../MessageTriggerService'

afterEach(() => {
    jest.restoreAllMocks()
})

describe('notifyJourney', () => {
    test('a failed follow-up enqueue does not propagate', async () => {
        jest.spyOn(App.main.queue, 'enqueue').mockRejectedValue(new Error('redis down'))

        await expect(notifyJourney('123')).resolves.toBeUndefined()
    })
})
