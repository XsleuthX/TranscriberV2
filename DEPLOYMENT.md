# Host Transcriber v2.33

The source repository is https://github.com/XsleuthX/TranscriberV2.
Deploy this app to one Node/container service. A hosting provider has not yet been selected.

## How it works

GitHub stores the code and runs verification. The hosting service runs the app:
one HTTPS address serves the editor, authenticated API routes, Iconik streaming,
and FFmpeg audio extraction. GitHub Pages alone cannot run this backend; it
supports static files ([GitHub documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)).

## Repository and build workflow

The application source lives at the repository root. The GitHub Actions workflow
installs locked dependencies, runs unit/browser regressions, builds the frontend,
and builds a Docker image. It verifies the build; it does not publish a website
or push a container. Connect this repository to the chosen hosting service.

## Configure the host

Use the included Dockerfile, or install Node.js 22+, run `npm ci`,
`npm run build`, and `npm start`. Use a single running instance initially.

Set these **runtime environment variables in the hosting service**:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Port assigned by the host; default 3000 |
| `APP_ORIGIN` | Exact public HTTPS origin, e.g. `https://transcriber.example.com`, without a trailing slash |
| `APP_PASSWORD` | A unique workspace password, at least 16 characters |
| `OPENAI_API_KEY` | Optional server key; users may instead enter a session key in the app |
| `ICONIK_AUTH_TOKEN`, `ICONIK_APP_ID` | Optional shared workspace integration credentials; users can instead connect in Media Pool |

Other optional settings are listed in `.env.example`. The server refuses to
start in production without its origin and password. The Docker image contains
no credentials; do not put secrets in build arguments or GitHub source files.

Your host must terminate HTTPS, preserve the public Host header, allow outgoing
HTTPS to Iconik/storage and AI services, and provide writable temporary disk
space. Every media upload request is limited to 8 MB chunks, which reduces proxy
request-size problems. Local extraction supports input up to 5 GB and audio up
to two hours; temporary disk needs room for the input plus decoded samples.
Iconik extraction needs room for proxy downloads too. Start with a service with
several GB of RAM and disk, then measure your typical recordings before sizing it.
Use `/healthz` for the host health check.

## Try the container locally

```powershell
docker build -t transcriber:2.33 .
docker run --rm -p 3000:3000 --env-file .env transcriber:2.33
```

For that local test, set `APP_ORIGIN=http://localhost:3000` and a workspace
password in your private `.env`. Open `http://localhost:3000` and sign in.
The Dockerfile enables production mode and includes FFmpeg.

## What this hosting release provides

- One password-protected private workspace, with 12-hour HttpOnly sessions,
  bounded login attempts, same-origin API checks, and protected server keys.
- Per-browser Iconik connections held in server memory, completed proxy
  streaming, range playback, expired URL refresh, and audio extraction.
- Local media decoding in the browser when supported; large/unsupported media
  is sent in bounded chunks to this app server. The extraction queue processes
  one local job at a time, isolates upload ownership, and removes temporary files.
- Provider requests share the same API implementation in local and hosted modes.

## Persistence and current scope

Projects still autosave in **each browser's IndexedDB**. Moving to another origin,
browser, or computer does not transfer that project. Export a project backup
before moving from the local app to the hosted URL, then import it there. Local
video playback needs relinking after reload; short decoded audio may remain in
the browser cache. Transcripts, story references, and timeline edits persist.

This is a private workspace release, not a multi-user collaboration service.
It has no account management, cloud project database, shared media library,
durable extraction queue, or autoscaling. Restarting the server expires login
and Iconik sessions and interrupts unfinished jobs; reconnect/reimport afterward.
Use one instance until those features are added. Server-side Iconik credentials
are shared by people with the workspace password.

The CI/container files have been prepared locally. GitHub Actions execution,
the Docker image, HTTPS reverse-proxy behavior, and your live Iconik/OpenAI
accounts require verification on the chosen host before production use.

## Verify after deployment

Sign in; import a local MP4; transcribe with your selected speech model; translate
with GPT-6.1 Sol; switch sources while editing a multi-media Story assembly;
connect a real Iconik asset; preview timeline layers and subtitles; export and
reload a project. Confirm reconnect and expired-session behavior. Keep media and
project backups outside the app while checking the first hosted release.
