# SOL on WhatsApp

Owners connect their phone once (Dashboard → SOL → Settings → **Connect WhatsApp**: one tap opens WhatsApp with
`LINK 123456` pre-typed). After that they message Plexo's WhatsApp number and SOL does the work on their account
and answers in the chat. Risky actions ask for **YES/NO** first. `NEW` starts a fresh chat, `STOP` disconnects.
On a computer, the connect card also shows a QR code of the same pre-typed message to scan with the phone.

They can send **text, voice notes, photos and documents** (PDF, Word, text/CSV, up to 25 MB):
- Photos/documents are saved to the same private SOL attachment area as the dashboard's paperclip, so SOL reads them identically.
- Voice notes are transcribed with AWS Transcribe (English, en-US) and SOL echoes what it heard (`🎙️ "…"`) before acting,
  so a mis-heard word is caught. Needs the `transcribe:*TranscriptionJob` grant in `cdk/lib/compute-stack.ts`.
- Stickers, videos and other file types get a friendly "I can't open that yet" reply.

## How it runs

```
WhatsApp → Meta → POST /api/webhooks/whatsapp   (checks Meta's signature, answers 200 at once)
                    └─ async Invoke ─► SolChatFn (lambda/sol-chat, 15 min)
                                         lib/whatsapp/inbound.ts → the same prepareMessagesTurn the dashboard uses
                                         → reply via the Cloud API (lib/whatsapp/cloudApi.ts)
```

- Same credits, memory, BYOK and tool permissions as dashboard chat.
- Each Meta message id is claimed once (`WhatsAppMessage`), so webhook retries never run a turn twice.
- Local dev (no `SOL_CHAT_FUNCTION_NAME`) runs the turn inside the Next.js process.

## Going live = changing five GitHub secrets

Set these in the **staging** / **production** GitHub Environment, push (or re-run the deploy). The deploy workflows
copy them to SSM and the next cold start picks them up. No code change. Until all five are set the feature stays
off and the dashboard says "Coming soon".

| Secret | Where it comes from |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Meta Business Settings → System users → generate a **permanent** token (`whatsapp_business_messaging`, `whatsapp_business_management`) |
| `WHATSAPP_PHONE_NUMBER_ID` | Developer app → WhatsApp → API Setup |
| `WHATSAPP_APP_SECRET` | Developer app → App settings → Basic → App secret |
| `WHATSAPP_VERIFY_TOKEN` | Any random string you invent; paste the same one into Meta's webhook form |
| `WHATSAPP_BUSINESS_NUMBER` | The public number owners message, digits only (e.g. `2348012345678`) |
| `WHATSAPP_GRAPH_VERSION` | Optional, defaults to `v21.0` |

In the Meta app: WhatsApp → Configuration → Webhook → callback URL `https://<app domain>/api/webhooks/whatsapp`,
the verify token above, then subscribe to the **messages** field.

Testing before business verification: use Meta's free test number (add up to 5 recipient numbers in API Setup) and put
its values in the **staging** secrets. When the verified number is approved, replace the same secrets and redeploy.
