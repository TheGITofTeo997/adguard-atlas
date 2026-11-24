# AdGuard Atlas · Deploy sul NAS

Occorrono Docker con Compose, accesso a Internet per la build e un'istanza di AdGuard Home raggiungibile dal container.

## Prima installazione

1. Estrai lo ZIP nella cartella del progetto sul NAS.
2. Copia `.env.example` in `.env`. Imposta URL e credenziali di AdGuard Home, una password per il pannello (`DASHBOARD_PASSWORD`) e un segreto casuale per le sessioni (`SESSION_SECRET`). Imposta anche `SOURCE_LAT` e `SOURCE_LNG` per l'origine delle rotte sulla mappa.
3. Per AdGuard Home sul NAS, parti da `host.docker.internal` con la porta della sua interfaccia web. Per AdGuard Home su un altro dispositivo, usa il suo IP o hostname raggiungibile dal container. Se AdGuard Home condivide una rete Docker con Atlas, puoi usare il nome del servizio su quella rete.
4. Dalla cartella del progetto esegui `docker compose up -d --build`.
5. Apri `http://IP_DEL_NAS:8080` (oppure la porta impostata in `.env`). Puoi verificare lo stato con `docker compose ps` e leggere i log con `docker compose logs --tail=80 adguard-atlas`.

## Aggiornamento di un'installazione esistente

Estrai i file nella cartella della stessa installazione e conserva il tuo `.env`. Se usi un nome di progetto Compose personalizzato, mantienilo anche durante il deploy. Esegui di nuovo `docker compose up -d --build`. Il volume Compose `atlas-data` contiene la configurazione 2FA. Evita `docker compose down -v`, che rimuove il volume.

Il Dockerfile costruisce l'immagine sul NAS per la sua architettura. La prima build scarica l'immagine base e le dipendenze.
