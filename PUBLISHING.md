# Publish the first GitHub version

Use this clean source folder for uploading. Keep it separate from your working
project folder, which may contain .env, .venv, old archives and practice images.
There is no need to reinstall your already-working Photoshop panel for publishing.

1. Sign in to GitHub and open https://github.com/new.
2. Name the repository `photoshop-assistant`.
3. Suggested description: `AI-powered Photoshop assistant with Gemini chat and reviewed layer editing actions.`
4. Choose Public if you want to share it. Leave automatic README, .gitignore and
   license creation off for this initial upload; README and .gitignore are included.
   A license has not been chosen for you and can be added separately.
5. Create the repository. On its empty page, choose **uploading an existing file**.
   In an existing repository, use **Add file > Upload files**.
6. Drag the CONTENTS of the extracted `photoshop-assistant` folder into the upload
   area, including the extension directory, .gitignore and .env.example. Upload
   the source files, not only the ZIP, and preserve the extension subdirectories.
7. Confirm the upload list contains no real `.env`, `.venv`, API keys or PSDs.
   `.env.example` is intended for upload and contains a placeholder only.
   Do not rely on .gitignore to filter files manually selected for browser upload.
8. Use commit message `Add Photoshop Assistant v1.4.0` and commit the files.
9. Verify README.md appears on the repository home page and that
   `extension/CSXS/manifest.xml` exists at that path.

The finished repository should contain the source, README, requirements.txt,
tests, .gitignore and .env.example. It should not contain the real secret file.
Do not insert a working API key into README examples or screenshots.

Optional polish: record a 30–60 second demo showing a learning question, a
two-step request, the review, Apply and Photoshop Undo. This is not required
before the initial upload.

Uploading the source does not host Photoshop or run the Python server. Each
person downloads the project and runs it locally with their own Gemini key.

Official upload guide:
https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
