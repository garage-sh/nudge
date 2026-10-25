# Sécurité

## Signaler une faille

Ne signalez pas une faille dans une issue publique. Utilisez le [signalement privé de GitHub](https://github.com/garage-sh/nudge/security/advisories/new) : seuls les mainteneurs le voient.

Décrivez la faille, la version touchée (tag de l'image ou commit), les étapes pour la reproduire et son impact. Vous recevrez une réponse sous sept jours. Une fois la faille corrigée et publiée, le signalement devient un avis de sécurité public, qui vous crédite si vous le souhaitez.

## Versions suivies

Les correctifs de sécurité sont publiés sur la dernière version mineure. Mettez à jour avec `docker compose pull && docker compose up -d`.

## Vérifier les images

Chaque image publiée sur `ghcr.io/garage-sh` est signée avec cosign depuis la CI du dépôt, et porte un SBOM et une attestation de provenance. La commande de vérification est dans le [README](README.md#mettre-à-jour-sauvegarder-monter-en-charge).
