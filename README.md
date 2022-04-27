# Pythia Defender Autotasks

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

A collection of autotasks for use with [OpenZeppelin Defender](https://openzeppelin.com/defender/) to perform Pythia oracle maintenance.

## Install

### Requirements

-   node: v14 or later
-   yarn
-   git

### Recommendations

-   Operating system: Linux (Fedora is used for development and testing)

### Procedure

1. Clone the repository

```console
git clone git@github.com:pythia-oracle/pythia-defender-autotasks.git
```

2. Enter the project folder

```console
cd pythia-defender-autotasks
```

3. Install using yarn

```console
yarn install --lock-file
```

4. Generate typescript bindings

```console
yarn typechain:generate
```

## Usage

### Building autotask scripts

1. Configure [pythia.config.js](pythia.config.js)
2. Build the autotask scripts for distribution

```console
yarn build
```

### Running locally

1. [Build the autotask scripts](#building-autotask-scripts)
2. Set the environment variables `API_KEY` and `API_SECRET` to the values corresponding with your [relayer](https://docs.openzeppelin.com/defender/relay) (create one if you haven't already, and make sure to fund it)
3. Run the script

```console
yarn start-oracle-updater
```

### Deploying

1. [Build the autotask scripts](#building-autotask-scripts)
2. Create (or modify) an [autotask](https://docs.openzeppelin.com/defender/autotasks) using the generated code in the [dist folder](dist/), such as [dist/tasks/oracle-updater.js](dist/tasks/oracle-updater.js) (make sure to connect and fund your relayer)

## Security

If any security vulnerabilities are found, please contact us via Discord (TylerEther#8944) or email (tyler@trilez.com).

## Contributing

Not open to contributions at this time.

## License

Pythia Defender Autotasks is licensed under the [MIT License](LICENSE).
