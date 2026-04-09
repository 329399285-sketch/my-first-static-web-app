# Vanilla JavaScript App

[Azure Static Web Apps](https://docs.microsoft.com/azure/static-web-apps/overview) allows you to easily build JavaScript apps in minutes. Use this repo with the [quickstart](https://docs.microsoft.com/azure/static-web-apps/getting-started?tabs=vanilla-javascript) to build and customize a new static site.

This repo is used as a starter for a _very basic_ HTML web application using no front-end frameworks.

This repo has a dev container. This means if you open it inside a [GitHub Codespace](https://github.com/features/codespaces), or using [VS Code with the remote containers extension](https://code.visualstudio.com/docs/remote/containers), it will be opened inside a container with all the dependencies already installed.

## Cloud Sync + PDF Export (Azure Static Web Apps)

This project now supports:
- Cloud document storage via Azure Static Web Apps API + Azure Blob Storage.
- Cross-device sync (`/api/documents`).
- PDF export in browser (`下载 PDF` button).

### Required Azure configuration

In your **Azure Static Web App > Configuration > Application settings**, set:
- `AZURE_STORAGE_CONNECTION_STRING` = your Azure Storage Account connection string
- `DOCS_CONTAINER_NAME` (optional) = blob container name, default is `word-card-documents`

After deployment:
1. Upload/parse documents in one device.
2. On another device, open the same website and click `云端同步`.
3. Click `下载 PDF` to export the currently selected parsed document.
