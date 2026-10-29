# Account setup

YouTube Sponsor Scout needs a Google account (for YouTube search, the Sheet, and a one-time Google sign-in) and a Hunter.io account (for sponsor contacts). Everything here works on free plans. Your Grok Bot agent does most of the work with the `gcloud` CLI; these steps cover the parts only you can do in your own browser.

Never paste a password into the chat. When the agent needs a key or secret, it shows a masked field.

## 1. Google account and Cloud project

1. If you don't have a Google account, create one at [accounts.google.com/signup](https://accounts.google.com/signup).
2. Create a Google Cloud project at [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate). Give it a name such as `youtube-sponsor-scout`. The project ID must be unique across Google Cloud, so if it's taken, click **Edit** and add your initials or a number. No billing account is needed.
3. Tell your agent the project is ready. It will list your projects and let you pick it.

The agent installs the Google Cloud CLI itself. If you want it on your own computer too, see [Install the gcloud CLI](https://cloud.google.com/sdk/docs/install).

## 2. Enable the APIs

The agent enables these with `gcloud` once you pick the project. If you prefer to do it yourself, open each page, choose your project at the top, and click **Enable**:

- [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
- [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
- [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) (only used to confirm the sign-in; the skills never send mail)

The YouTube Data API is free. Google's [default quota](https://developers.google.com/youtube/v3/getting-started) allows 100 search calls a day, plus 10,000 units a day for other calls such as video details. A sponsor run uses at most two searches. The quota resets daily at midnight Pacific time.

The YouTube key itself is created by the agent (`b11_youtube-key`), so you don't need to visit the Credentials page for it.

## 3. Google sign-in (OAuth) client

`b13_gmail-workspace-account` uses a one-time sign-in so the agent can create the Sponsors sheet in your own Drive. Google requires you to create the sign-in client yourself:

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) for your project. If it says "not configured yet", click **Get started**. Enter an app name and your email, choose **External**, agree, and click **Create**. Don't add a logo (that triggers Google review).
2. Open [Audience](https://console.cloud.google.com/auth/audience). Under **Test users**, add your own Gmail address. Optionally click **Publish app** so the sign-in doesn't expire after 7 days.
3. Open [Create client](https://console.cloud.google.com/auth/clients/create). Choose **Desktop app**, name it, and click **Create**. (You can also reach clients from [Credentials](https://console.cloud.google.com/apis/credentials).)
4. Keep the window open. Give the agent the **Client ID** in chat, and the **Client secret** (starts with `GOCSPX-`) in the masked field it shows.
5. The agent then sends a "Sign in to Google" link. Open it in your own browser, choose your account, tick every box, and copy the whole `http://localhost/...` address from the "can't be reached" page back to the agent.

You can remove this access any time at [Google third-party access](https://myaccount.google.com/connections).

## 4. Sheets service account

`b14_sheets-service-account` creates a separate robot account (a service account) in your project and saves its key to the tool's `.env`. The CLI uses it to append rows. Nothing to do here beyond having a project (step 1); if your Google organization blocks service-account keys, an admin has to allow them.

## 5. Hunter.io account and API key

1. Sign up free at [hunter.io/users/sign_up](https://hunter.io/users/sign_up).
2. Open [hunter.io/api-keys](https://hunter.io/api-keys), on a computer if you can (on a phone, switch the browser to its desktop site). Copy your default key with the copy icon.
3. Paste it into the masked "Hunter.io API key" field your agent shows.

The free plan includes 50 credits a month; a Domain Search uses 1 credit per email found (see [Hunter pricing](https://hunter.io/pricing)). The scout enriches each sponsor domain once per run without asking; if Hunter reports the plan limit is reached, it marks the remaining sponsors "no contact found (Hunter limit reached)" and says so in the summary.

## 6. Sponsors sheet

`b15_sponsor-sheet` creates a sheet named "YouTube Sponsor Scout" in your Drive with a **Sponsors** tab and these columns: Video URL, Video Timestamp, Brand Domain, Sponsor Name, Decision Maker Name, Job Title, Contact Email, Extracted Quote, Outreach Pitch, Logged At, Status. It shares the sheet with the service account from step 4. This needs steps 3 and 4 done first.

## Node.js

The Grok Bot box already has Node.js. To run the CLI elsewhere, install Node.js 18 or newer from [nodejs.org](https://nodejs.org/en/download).
