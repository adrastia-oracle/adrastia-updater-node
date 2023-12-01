# Adrastia Automatos Node

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

A node for running Adrastia Automatos workers.

## Install

### Requirements

-   node: v18 or later
-   yarn
-   git

### Recommendations

-   Operating system: Linux (Fedora is used for development and testing)

### Procedure

1. Clone the repository

```console
git clone git@github.com:adrastia-oracle/adrastia-updater-node.git
```

2. Enter the project folder

```console
cd adrastia-updater-node
```

3. Install using yarn

```console
yarn install --lock-file
```

4. Build the project

```console
yarn build
```

## Usage

### Configuration

1. Copy the [.env.example](.env.example) file to `.env` and modify the values as needed
2. Configure [adrastia.config.js](adrastia.config.js)

### Standalone application

Execute the `run-oracle-updater` hardhat task. Refer to the usage instructions with the `--help` flag for more information:

```console
npx hardhat run-oracle-updater --help
```

#### Run as a systemd service

Refer to the [systemd service](services/README.md) documentation for more information.

## Security

If any security vulnerabilities are found, please contact us via Discord (TylerEther#8944) or email (tyler@trilez.com).

## Contributing

Not open to contributions at this time.

## License

Adrastia Updater Node is licensed under the [Business Source License 1.1 (BUSL-1.1)](LICENSE).

### Exceptions

- The file located at [contracts/AutomationCompatibleInterface.sol](contracts/AutomationCompatibleInterface.sol) is licensed under the MIT License, Copyright (c) 2018 SmartContract ChainLink, Ltd.
