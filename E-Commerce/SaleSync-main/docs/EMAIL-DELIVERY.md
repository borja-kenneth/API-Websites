# Verification email delivery

Inbox placement is controlled by the receiving mailbox provider. No HTML design, priority header or application setting can guarantee it. Successful Gmail SMTP authentication confirms only that the app can submit messages, not that SPF/DKIM/DMARC pass or that recipients place messages in Inbox.

## Findings on 22 October 2026

The previous sender used the school domain `plpasig.edu.ph`. Read-only DNS checks for that sender found:

| Lookup | Result |
| --- | --- |
| SPF TXT at `plpasig.edu.ph` | No SPF record found |
| DMARC TXT at `_dmarc.plpasig.edu.ph` | No record found |
| DKIM TXT at `google._domainkey.plpasig.edu.ph` | No record found for the default `google` selector |

The school may use a different DKIM selector. Its absence at `google` does **not** prove that received messages have no valid DKIM signature. Actual authentication results and the reason for Spam placement remain unverified until the received message headers are inspected. DNS settings and mailbox reputation can change; rerun diagnostics before making administrative changes.

The application has since switched to the dedicated `salesync42@gmail.com` sender. SMTP authentication succeeded and the backend was restarted with that account. The school-domain findings above are historical and do not describe Gmail's domain. A new message's actual inbox placement has not been checked. Set the dedicated account's profile picture to the SaleSync logo to keep the personal account's photo unchanged.

## App changes completed

- The authenticated sender, visible From, Reply-To, and SMTP envelope sender explicitly use the same account.
- TLS requires certificate validation and at least TLS 1.2.
- Verification messages contain account-verification copy, a plain-text alternative and the requested branded HTML design. Promotional wording was removed.
- Automatic-message headers identify generated transactional mail and suppress auto-reply loops. They do not override spam classification.
- No fabricated SPF/DKIM/DMARC result, priority flag, tracking pixel, or bulk mailing header is added. Google must sign the outgoing message with the actual domain configuration.
- Existing code expiry, single use, resend cooldowns and sending quotas remain enforced.

These changes improve consistency and transport configuration. Their effect on recipient classification has not been verified; domain authentication is still an external dependency.

## Steps for the school’s email/DNS administrator

1. Confirm the sender is an authorized Google Workspace mailbox for this application.
2. Review **all** legitimate senders for the domain and publish one correct SPF record authorizing them. Do not blindly replace an existing SPF record or publish a second one.
3. Configure DKIM signing for the domain in Google Workspace, publish the generated selector/key in DNS, and enable authentication. Use the selector actually configured by the administrator.
4. Configure DMARC after checking SPF/DKIM alignment and monitoring. Choose policy/report recipients according to the school’s requirements.
5. Inspect a newly received verification message: SPF, DKIM, and DMARC results, From alignment, and receiving provider’s warnings. Check spam complaints and sender reputation if authentication passes but messages remain in Spam.

References: [Google sender requirements](https://support.google.com/mail/answer/81126), [SPF setup](https://support.google.com/a/answer/10685031), [DKIM setup](https://support.google.com/a/answer/174124), [DMARC setup](https://support.google.com/a/answer/2466580). No DNS changes were made by this project.

## Inspect a received Gmail message

Use Gmail in a desktop browser, open the message itself, and select the three-dot menu **next to the Reply arrow inside the message**, then **Show original**. This is not Chrome’s menu or the top mailbox toolbar. Share only the SPF/DKIM/DMARC results for initial troubleshooting; do not publish verification codes or account credentials. [Google’s header instructions](https://support.google.com/mail/answer/29436).

For a message you recognize and requested, Gmail’s **Not spam** action moves your own copy out of Spam. This does not change every customer’s mailbox rules or fix the sending domain’s authentication.

## Read-only diagnostics

```powershell
npm.cmd run email:dns
# If the received DKIM-Signature specifies a different selector (s=...):
npm.cmd run email:dns -- --selector=actual-selector
```

The command reads only the sender domain from the local configuration, checks public DNS, and saves `.preview/email-dns-report.json`. It never prints credentials, sends messages or changes DNS. Lookup failures are reported as unknown rather than missing records. DNS evidence alone cannot prove a delivered message passes authentication.
