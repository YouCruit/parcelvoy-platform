import nodeScheduler from 'node-schedule'
import App from '../../app'
import JourneyDelayJob from '../../journey/JourneyDelayJob'
import { logger } from '../logger'
import scheduler from '../scheduler'

jest.mock('../../core/Lock', () => ({
    ...jest.requireActual('../../core/Lock'),
    acquireLock: jest.fn().mockResolvedValue(true),
}))

afterEach(() => {
    jest.restoreAllMocks()
})

const flush = () => new Promise(resolve => setImmediate(resolve))

describe('scheduler', () => {

    test('a failed enqueue on a tick is logged, not left unhandled', async () => {
        const ticks: Record<string, () => Promise<void>> = {}
        jest.spyOn(nodeScheduler, 'scheduleJob').mockImplementation(((rule: string, tick: () => Promise<void>) => {
            ticks[rule] = tick
            return {} as nodeScheduler.Job
        }) as any)
        const error = new Error('redis down')
        jest.spyOn(App.main.queue, 'enqueue').mockRejectedValue(error)
        jest.spyOn(JourneyDelayJob, 'enqueueActive').mockRejectedValue(error)
        const logged = jest.spyOn(logger, 'error').mockImplementation()

        scheduler(App.main)
        await ticks['* * * * *']()
        await flush()

        // enqueueActive plus the two single enqueues on the minute tick
        expect(logged).toHaveBeenCalledTimes(3)
        expect(logged).toHaveBeenCalledWith(error, 'scheduler:error:enqueue')
    })
})
