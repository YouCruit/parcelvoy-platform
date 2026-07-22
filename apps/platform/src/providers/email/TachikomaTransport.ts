import nodemailer from 'nodemailer'

export class TachikomaTransport implements nodemailer.Transport {
    name = 'tachikoma'
    version = '1.0.0'

    constructor(private baseUrl: string, private token: string) {}

    send(mail: any, callback: (err: Error | null, info: any) => void) {

        const payload = {
            subject: mail.data.subject,
            from: mail.data.from,
            html: mail.data.html,
            text: mail.data.text,
            to: [{ address: mail.data.to }],
            attachments: mail.data.attachments,
            headers: mail.data.headers,
        }

        fetch(`${this.baseUrl}/tachikoma/sendEmail`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Bridge-Token': this.token,
            },
            body: JSON.stringify(payload),
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`)
                }
                callback(null, { ...response, messageId: response })
            })
            .catch(error => {
                callback(error, null)
            })
    }
}
