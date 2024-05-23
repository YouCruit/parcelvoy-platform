import pino from 'pino'
import ErrorHandler, { ErrorConfig } from '../error/ErrorHandler'

export const logger = pino({
    level: process.env.LOG_LEVEL || 'warn',
})

export default async (config: ErrorConfig) => {
    return new ErrorHandler(config)
}
