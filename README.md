# Kuzelle Invoices

Invoice and receipt generator + tracker for Kuzelle.
Static app (public/) + one Netlify Function (netlify/functions/api.mjs) that stores
records in Netlify Blobs, Netlify's built-in storage. No other accounts or keys needed.

## Folder
public/                    the app (index.html, offline worker, icons)
netlify/functions/api.mjs  login check + sync API
netlify.toml               tells Netlify what to publish
package.json               the one dependency (@netlify/blobs)

## Deploy (free), about 10 minutes
Drag-and-drop deploys can't run functions, so this goes through GitHub:

1. github.com: New repository, name it kuzelle-invoices, Private, Create.
   Click "uploading an existing file" and drag in EVERYTHING inside this folder
   (public, netlify, netlify.toml, package.json, README.md). Commit.
2. app.netlify.com: Add new project > Import an existing project > GitHub >
   pick kuzelle-invoices. Leave the build settings as they are > Deploy.
3. Project configuration > Environment variables > Add variable:
      ACCESS_CODE = your 6-digit code          (required)
      SESSION_SECRET = any long random text    (optional, recommended)
   Then Deploys > Trigger deploy > Deploy project.
4. Open the site and enter the code.

Later changes: edit or re-upload files on GitHub and Netlify redeploys by itself.

## Changing the code
Change ACCESS_CODE in Netlify and redeploy. Everyone is signed out and uses the new code.
Keep it 6 digits, or change CODE_LENGTH near the top of the script in public/index.html.

## How data works
- Every save is written to the device first, then uploaded within a second.
- Offline? Keep working. Changes queue and upload when the connection returns.
- All devices see the same records. If two devices edit the same document, the latest edit wins.
- First login on a device that has records from the old version: the app offers to upload them.
- Raw data: Netlify > your project > Blobs > store "kuzelle".
- Settings > Export backup still works and is worth doing monthly.

## Free-plan budget
Netlify's free plan gives 300 credits a month. Each production deploy costs 15;
everyday use of the app costs a few. Avoid redeploying dozens of times a month.
