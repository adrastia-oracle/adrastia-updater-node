#!/bin/bash
for service in $(systemctl list-units --type=service --state=loaded --all | grep 'adrastia-' | awk '{print $1}'); do
    if systemctl is-enabled --quiet "$service"; then
        echo "Restarting enabled service: $service"
        systemctl restart "$service"
    else
        echo "Skipping disabled service: $service"
    fi
done
