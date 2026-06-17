# Pranešimai API

[![License](https://img.shields.io/github/license/vmvt-devhub/pranesimai-api)](https://github.com/vmvt-devhub/pranesimai-api/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/vmvt-devhub/pranesimai-api)](https://github.com/vmvt-devhub/pranesimai-api/issues)
[![GitHub stars](https://img.shields.io/github/stars/vmvt-devhub/pranesimai-api)](https://github.com/vmvt-devhub/pranesimai-api/stargazers)

This repository contains the source code and documentation for the VMVT pranešimai, developed by the VMVT

## Table of Contents

- [About the Project](#about-the-project)
- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Usage](#usage)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## About the Project

The Pranešimai API is designed to provide functionalities of collecting surveys about different food and vetinary services

## Getting Started

To get started with the Pranešimai API, follow the instructions below.

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/vmvt-devhub/pranesimai-api-fork.git
   ```

2. Install the required dependencies:

   ```bash
   cd pranesimai-api
   yarn install
   ```

### Usage

1. Set up the required environment variables. Copy the `.env.example` file to `.env` and provide the necessary values for the variables.

2. Start the API server:

   ```bash
   yarn dc:up
   yarn dev
   ```

The API will be available at `http://localhost:3000`.

### Development tooling

Recommended VS Code extensions:

- ESLint (`dbaeumer.vscode-eslint`)

This workspace includes `.vscode/settings.json` so VS Code uses the repo TypeScript SDK and ESLint flat config. If
Problems look stale after dependency or config changes, run `Developer: Reload Window`.

Useful checks:

```bash
yarn run lint
yarn run lint:fix
yarn run typecheck
yarn run validate
yarn run build
```

Git hooks:

- Pre-commit runs `lint-staged` on staged files.
- Pre-push runs `yarn run validate` on the full project.

## Deployment

### Production

To deploy the application to the production environment, create a new GitHub release:

1. Go to the repository's main page on GitHub.
2. Click on the "Releases" tab.
3. Click on the "Create a new release" button.
4. Provide a version number, such as `1.2.3`, and other relevant information.
5. Click on the "Publish release" button.

### Staging

The `main` branch of the repository is automatically deployed to the staging environment. Any changes pushed to the main
branch will trigger a new deployment.

### Development

To deploy any branch to the development environment use the `Deploy to Development` GitHub action.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, please open an issue or submit a
pull request. For more information, see the [contribution guidelines](./CONTRIBUTING.md).

## License

This project is licensed under the [MIT License](./LICENSE).
