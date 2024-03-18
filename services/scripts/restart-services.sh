#!/bin/bash

# Prefix
prefix="adrastia-"

# Check for optional 'chain' argument
if [ ! -z "$1" ]; then
  prefix="${prefix}$1-"
fi

for service in $(systemctl list-units --type=service --state=loaded --all | grep "^$prefix" | awk '{print $1}'); do
    if systemctl is-enabled --quiet "$service"; then
        echo "Restarting enabled service: $service"
        systemctl restart "$service"
    else
        echo "Skipping disabled service: $service"
    fi
done
