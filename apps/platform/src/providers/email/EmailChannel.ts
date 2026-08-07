import App from '../../app'
import { Variables } from '../../render'
import { EmailTemplate } from '../../render/Template'
import { unsubscribeEmailLink } from '../../subscriptions/SubscriptionService'
import { encodeHashid, pick } from '../../utilities'
import { Email } from './Email'
import EmailProvider from './EmailProvider'

export default class EmailChannel {
    readonly provider: EmailProvider
    constructor(provider?: EmailProvider) {
        if (provider) {
            this.provider = provider
            this.provider.boot?.()
        } else {
            throw new Error('A valid mailer must be defined!')
        }
    }

    /**
     * Build the internal correlation headers stamped onto every outbound email.
     *
     * These are consumed by the email-bridge, which joins delivery/engagement
     * events back to the campaign and subscriber that produced them. The bridge
     * strips every one of these before the message reaches the recipient, so
     * they must never carry anything we would not want stripped — if a header
     * added here is not also in the bridge's strip list it ships to recipients.
     *
     * Extracted from send() purely so the header contract is testable without a
     * provider, a compiled template, or a booted App.
     */
    buildHeaders(variables: Variables): Record<string, string> {
        return {
            'X-Campaign-Id': encodeHashid(variables.context.campaign_id),
            'X-Subscription-Id': encodeHashid(variables.context.subscription_id),
            'X-External-Id': variables.user.external_id ?? '',
            'X-Reference-Id': variables.context.reference_id ?? '',
            'X-Subscription-Id-Raw': String(variables.context.subscription_id),
        }
    }

    async send(template: EmailTemplate, variables: Variables) {
        if (!variables.user.email) throw new Error('Unable to send a message to a user with no email.')

        // TODO: Explore caching the Handlebars template
        // before passing in variables for better performance
        const compiled = template.compile(variables)
        const email: Email = {
            ...compiled,
            to: variables.user.email,
            headers: this.buildHeaders(variables),
            list: {
                unsubscribe: unsubscribeEmailLink({
                    userId: variables.user.id,
                    campaignId: variables.context.campaign_id,
                    referenceId: variables.context.reference_id,
                }),
            },
        }
        const result = await this.provider.send(email)
        return {
            ...pick(result, [
                'messageId',
                'messageSize',
                'messageTime',
                'envelope',
                'accepted',
                'rejected',
                'pending',
                'response',
            ]),
            message: App.main.env.config.logCompiledMessage ? compiled : undefined,
        }
    }

    async verify(): Promise<boolean> {
        await this.provider.verify()
        return true
    }
}
