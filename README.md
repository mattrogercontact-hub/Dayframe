# Dayframe

A calm household calendar for a 1920×1080 kitchen touchscreen. It works locally with sample events. An optional Google Calendar connection reads selected calendars and, after event write permission is granted, adds, edits, and deletes supported events. Read-only Apple Calendar subscriptions can also be shown. A private iCloud CalDAV connection is in staged setup. Google credentials, the iCloud app-specific password, and Apple sharing links never go into browser code or localStorage.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the local address Vite prints, usually `http://127.0.0.1:5173/`. In Chrome or Chromium, press F11 for full-screen viewing. ChromeOS kiosk mode can use the same local address when served on that device.

For Google Calendar, use `http://localhost:5173/` exactly, so the OAuth callback and browser cookie use the same host. Stop and restart the dev server after changing `.env.local`.

To check and preview the production app:

```sh
npm run lint
npm test
npm run build
npm run test:browser
npm run preview
```

For a local production server with the Calendar API, stop the dev server, then run `npm run build` and `npm start`. The server listens on `localhost:5173` only. `npm run preview` is for a static UI preview and does not run the Calendar API.

The optional browser check uses installed Google Chrome.

The installed PWA caches its application shell after the first successful production load. Development mode does not register the service worker.

## Using Dayframe

Choose Agenda, Week, or Month in the side navigation or the Display panel. The header shows today's date, local time, and current weather with a weather emoji; select the weather summary to change its location in Display. The **Calendars** dropdown beside each view's date controls lists enabled calendars and lets you show or hide several at once. Its filter is saved on this display and does not change the Google connection; use Display to enable additional Google calendars. Local examples are labeled as samples because they have no owner. Week and Month start on Sunday. Opening the current Week scrolls its time grid to the live time line; other weeks keep their normal position. The last face selected through navigation or Display becomes the default after refresh; an older saved Split preference opens Agenda. Tapping a Month date or “+ more” opens that day in Agenda without changing the saved default. Agenda, Week, and Month all have period navigation. Display offers Light, Dark, Cozy, and High contrast themes. For Google events that contain only an automatically created placeholder, details explain the limitation.

The original five example events are attached to the local date of first launch; a few extra week-grid examples demonstrate all-day, long, and overlapping events. They do not repeat on future days. Use the floating **+** button in Agenda, Week, or Month to add an event. In Week, tapping an empty hour shows a temporary event block and opens Add event with that day and hour filled in; Cancel removes the preview without saving. Tap an existing event for details and use the pencil icon to edit, the trash icon to review deletion, or the X icon to close. The sidebar and event popup icons are bundled locally from Bootstrap Icons; the Bootstrap CSS framework is not used. Local edits persist in this browser; connected Google edits save to the selected calendar. Local deletions can be undone until the page reloads; Google deletions may be recoverable from Google Calendar Trash. Moving a start date past the end date moves the end date to match; moving a start time past the end time moves the end 30 minutes later, including across midnight. Existing formatted notes keep their formatting if untouched; changing notes saves plain text. URLs inside notes remain readable text but do not open other pages. New Google events can repeat daily, weekly, monthly, or yearly. When editing or deleting an occurrence, Dayframe asks whether to act on that occurrence or the entire series. A series edit keeps its existing repeat rule. Locked and special Google events still require Google Calendar. The Week time grid has a live line for the current time. Today's Agenda automatically hides timed events after they end; all-day events and other dates remain visible. Text fields use the system keyboard by default. On Debian, choose **Display → Touch keyboard → Dayframe keyboard** if an operating-system keyboard does not open. Dates use the browser picker; tapping a time opens Dayframe's hour, minute, and AM/PM scroll wheels. Physical keyboards can still edit the time field.

For weather, choose **Display → Weather**, search for a city or postal code, then select a location. Dayframe shows current conditions in the header from [Open-Meteo](https://open-meteo.com/) without an API key. It refreshes every 30 minutes while open and keeps the last reading if a refresh fails. Until you choose a location, no weather is fetched and no temperature is invented. Location search sends your typed query to Open-Meteo; after selection, forecast requests send the selected coordinates. Internet access is required.

The browser stores data in `dayframe.display.v1`, `dayframe.groceries.v1`, `dayframe.events.v1`, and `dayframe.weather.v1` localStorage keys. To reset Dayframe, remove those four keys in Chrome DevTools → Application → Local storage, then refresh. If private browsing or browser settings block localStorage, Dayframe remains usable during the session but shows a persistence notice.

## Grocery list paused

The grocery controls are hidden for now. Existing local grocery data and the Keep connector code remain in place for a future return. Google's Keep authorization rejected this personal account with `Error 400: invalid_scope`.

The [Google Keep API reference](https://developers.google.com/workspace/keep/api/reference/rest/v1/notes) has no method to update an existing note or checklist. The existing connector requests only the documented `keep.readonly` scope and never changes Keep notes. The [Keep API](https://developers.google.com/workspace/keep/api/guides) is intended for enterprise use; a personal Gmail account can receive Google's `Error 400: invalid_scope` before Dayframe gets access. Google Tasks can edit lists, but would be a separate list from the one Google Home maintains in Keep.

## Optional Google Calendar connection

Dayframe reads selected Google calendars and can create, edit, or delete ordinary events on selected calendars with writer or owner access. Deletion requires an in-app confirmation. The local sample events remain available when disconnected. The Display panel lets you connect, select calendars, refresh, and disconnect. An existing read-only connection must use **Enable editing** to grant the new permission; reconnecting preserves selected calendars. Connected events update automatically every five minutes while the page is open and when the page becomes visible or the network reconnects. Display → Google Calendar shows the last successful update, errors, and a Retry sync button. If a refresh fails, previously loaded events remain visible with an unavailable message. Calendar requests and refresh tokens stay on the local Node server. The token store is AES-256-GCM encrypted in `.dayframe-private/`, which is ignored by Git; keep your encryption key safe or you will need to reconnect.

Setup on the computer running Dayframe:

1. In [Google Cloud Console](https://console.cloud.google.com/), create/select a project and enable the Google Calendar API.
2. Configure the OAuth consent screen. If the app is in Testing, add the Google account you will connect as a test user. Request `https://www.googleapis.com/auth/calendar.readonly` and `https://www.googleapis.com/auth/calendar.events`.
3. Create an OAuth client of type **Web application**. Add this exact authorized redirect URI: `http://localhost:5173/api/calendar/callback`.
4. Copy `.env.example` to `.env.local`. Fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from that client. Generate a 32-byte encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `DAYFRAME_TOKEN_KEY` to its 64-character output. Keep `.env.local` private; do not paste it into chat or commit it.
5. Restart Dayframe, open `http://localhost:5173/`, then choose **Display → Google Calendar → Connect Google Calendar** (or **Enable editing** for an existing connection). After consent, select the calendars to show. New events go to the chosen selected calendar.

Google OAuth apps left in Testing can have authorizations, including offline refresh tokens, expire after seven days; reconnect if prompted. The connection requires Internet access for Google API calls. The server binds only to loopback, so a separate ChromeOS kiosk device cannot reach it directly; running the server on another home computer would require a later authenticated network setup.

The Dayframe display has no outbound content links. Google Calendar connection controls in Display, including Enable editing, are the exception: they open Google's sign-in page when used so account access can be granted or renewed.

The connector uses the existing `EventProvider` boundary. Server routes live under `/api/calendar/`; Google client credentials and refresh tokens never enter the frontend bundle. The Keep refresh token is stored separately and encrypted with the same local key. The PWA service worker deliberately never caches `/api/` responses. Keep access is read-only.

## Read-only Apple Calendar

Dayframe can show a public iCloud calendar subscription beside Google Calendar. In **Display → Apple Calendar**, enter a name and the calendar's public sharing link. Dayframe validates that the link points to an iCloud published calendar, fetches it through the local server, and stores the link encrypted with `DAYFRAME_TOKEN_KEY` in `.dayframe-private/`. The link does not enter browser storage. Apple events are labeled by source and can be filtered with the Calendars dropdown, but cannot be changed in Dayframe. The feed refreshes every 15 minutes while open; its status and Retry sync button are in Display → Apple Calendar. No Apple account is connected until a valid link is entered; live iCloud sync needs testing with your own calendar.

**Privacy:** Apple's Public Calendar switch makes the calendar viewable by anyone who has its link. Choose a calendar you are comfortable sharing this way. Do not paste the link into chat. If the same Apple calendar also appears through Google, it may show twice; disable one copy with the Calendars filter or remove one subscription.

Full two-way Apple editing is still in progress. Skylight uses Apple two-factor authentication and an app-specific password for its connection. Dayframe's private CalDAV setup is described below; recurrence, invitation handling, and live iCloud validation remain to be completed.

## Private iCloud Calendar setup in progress

Dayframe now has a separate **Display → iCloud account · private** connection. This uses CalDAV and does not require publishing a calendar. Enter an Apple Account email and an Apple **app-specific password** directly into Dayframe; never use the normal Apple Account password. The local server tests the connection and stores the credentials encrypted in `.dayframe-private/icloud-account.enc.json` using `DAYFRAME_TOKEN_KEY`. It returns only calendar names and IDs to Chrome. Choose the calendars to show. Private iCloud events refresh every five minutes while Dayframe is open, appear with their source name, and use the existing Calendars filter. Connection status and Retry sync are in Display → iCloud account · private. The public-link subscription remains a separate read-only option; showing the same calendar through both connections will produce duplicates.

**Editing is off by default.** Dayframe has guarded create and edit handlers for single, nonrecurring iCloud events, but `DAYFRAME_ICLOUD_WRITE_ENABLED` must be set to `1` on the local server before the controls appear or writes are accepted. Do this only after reviewing the connection with a dedicated test calendar and authorizing real changes. Repeating iCloud events remain read-only in Dayframe. iCloud deletion and invitation handling have not been implemented. A live Apple account and real CalDAV server have not yet been tested, so this connection should not be used for important events yet. Mock API and browser tests do not establish live compatibility.

What the account owner needs to do: enable two-factor authentication on the Apple Account if it is not already enabled, make a separate iCloud calendar for testing, create a Dayframe-specific password at `account.apple.com` under **Sign-In and Security → App-Specific Passwords**, and enter that password in Dayframe locally. Do not put the password in `.env.local` or chat. After a successful read-only connection, check that the test calendar and its events match an Apple device. Approve one test creation and one test edit before enabling writes. Disconnecting in Display removes Dayframe's encrypted credential file; the password can also be revoked from the Apple Account.

## Windows kiosk startup

Run `npm run build` first. `scripts/start-kiosk.ps1` starts the local production server when needed and opens Chrome in kiosk mode at `http://localhost:5173/` using a dedicated profile in `.dayframe-private/chrome-profile`. It does not connect the app to the home network or publish it. `scripts/install-kiosk-startup.ps1` can register a Windows task that launches the kiosk when this user signs in. Both scripts accept `-DryRun` to show their paths and actions without starting a process or changing Windows. The startup task has **not** been registered by this project; install it only after reviewing the script and authorizing the Windows configuration change. The dedicated Chrome profile has its own Display preferences, so set them once there after first launch.
