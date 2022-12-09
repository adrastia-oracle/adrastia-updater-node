# Adrastia Systemd Service

## Install

### Requirements

-   Any Linux distribution that supports [systemd](https://systemd.io/)
-   C/C++ tool stack (GCC/Clang, etc...)
-   Python 3
-   Follow the installation and usage instructions for the project at the root of this repository

### Pre-requisites

#### Install systemd header files

RHEL-based systems:

```console
sudo dnf install systemd-devel
```

#### Install node version manager

1. Clone the nvm repository to /opt/nvm

```console
sudo git clone https://github.com/nvm-sh/nvm.git /opt/nvm
```

2. Create a directory for NVM to store the installed versions of Node

```console
sudo mkdir /usr/local/nvm
```

3. Change the owner of the newly created directory to the user that will be running the services

```console

sudo chown <user>:<group> /usr/local/nvm
```

### Create a service

1. Make a copy of the service template with the file name in the format of `<service-name>.service`

Example:

```console
cp updater-template.service adrastia-polygon-0.service
```

2. Make a copy of the service script with the file name in the format of `<service-name>.sh`

Example:

```console
cp updater-template.sh adrastia-polygon-0.sh
```

3. Modify the service file and the service script, replacing all of the placeholders with the appropriate values

Placeholders:

-   `<service-name>`: The name of the service
-   `<user>`: The user that will be running the service
-   `<group>`: The group to use for the user that will be running the service
-   `<project-directory>`: The absolute path to the root project directory
-   `<check-every-x-seconds>`: The number of seconds to wait between checks
-   `<batch-number>`: The batch number to use for the oracle updater
-   `<network-name>`: The name of the network to use for the oracle updater

### Install the service

1. Copy the service file to the systemd directory

Example:

```console
sudo cp adrastia-polygon-0.service /etc/systemd/system/adrastia-polygon-0.service
```

2. Load the service

```console
sudo systemctl daemon-reload
```

## Usage

### Enable the service at startup

```console
sudo systemctl enable <service-name>.service
```

### Start the service

```console
sudo systemctl start <service-name>.service
```

### Stop the service

```console
sudo systemctl start <service-name>.service
```

### Check the status of the service

```console
sudo systemctl status <service-name>.service
```

### Check the logs of the service

```console
sudo journalctl -u <service-name>.service
```

Tip: Use the `-f` flag to follow the logs in real time

Tip: Use the `-r` flag to reverse the order of the logs (newest first)
