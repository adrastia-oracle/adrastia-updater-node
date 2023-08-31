# Adrastia Updater Node

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

A lite-node to perform updates for the Adrastia oracle system.

## Install

### Requirements

-   node: v16 or later
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

4. Compile contracts

```console
npx hardhat compile
```

5. Generate typescript bindings

```console
yarn typechain:generate
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

### OpenZeppelin Defender autotasks

#### Building autotask scripts

```console
yarn build
```

#### Running locally

```console
yarn run run start --help
```

#### Deploying

1. [Build the autotask scripts](#building-autotask-scripts)
2. Create (or modify) an [autotask](https://docs.openzeppelin.com/defender/autotasks) using the generated code in the [dist folder](dist/), such as [dist/tasks/oracle-updater.js](dist/tasks/oracle-updater.js) (make sure to connect and fund your relayer)

## Security

If any security vulnerabilities are found, please contact us via Discord (TylerEther#8944) or email (tyler@trilez.com).

## Contributing

Not open to contributions at this time.

## License

Adrastia Defender Autotasks is licensed under the [MIT License](LICENSE).
