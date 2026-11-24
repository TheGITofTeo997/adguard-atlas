# Widget di AdGuard Atlas per Homepage

Il widget usa [Custom API](https://gethomepage.dev/widgets/services/customapi/) di Homepage. Mostra il Paese con più query DNS geolocalizzate e il numero di Paesi raggiunti. In `homepage-services.example.yaml` trovi anche il campo facoltativo con le query verso il Paese in testa.

1. Genera un token casuale, per esempio con `openssl rand -hex 32`. Aggiungi `HOMEPAGE_API_TOKEN=...` al file `.env` di Atlas ed esegui `docker compose up -d --build`.
2. Imposta lo stesso valore nella variabile `HOMEPAGE_VAR_ATLAS_TOKEN` del container Homepage e ricrea quel container. [Variabili di ambiente di Homepage](https://gethomepage.dev/installation/docker/#using-environment-secrets)
3. Aggiungi il servizio di `homepage-services.example.yaml` a `services.yaml`. Cambia `href` con l'indirizzo di Atlas raggiungibile dal browser e `widget.url` con quello raggiungibile dal container Homepage. Puoi usare `http://adguard-atlas:8080/api/homepage` per `widget.url` se i due container condividono una rete Docker. Se hai già un gruppo `Rete`, aggiungi la voce a quel gruppo.

Atlas mantiene in memoria il minuto corrente e i 14 precedenti. Una query conta al massimo una volta per ciascun Paese, anche quando restituisce più IP nello stesso Paese. Vengono conteggiati solo i Paesi per cui Atlas ha ottenuto una geolocalizzazione. Una query con destinazioni in più Paesi contribuisce a ciascuno di essi.

La raccolta parte all'avvio di Atlas quando il token è configurato e prosegue anche con la mappa chiusa. Dopo un riavvio la finestra si ripopola con le nuove query. Il widget mostra `—` finché Atlas non ha una destinazione geolocalizzata. L'endpoint restituisce solo le metriche aggregate e richiede il token nell'header `X-Atlas-Token`.

Per controllare l'endpoint dal NAS:

```sh
curl -fsS -H "X-Atlas-Token: $ATLAS_TOKEN" http://127.0.0.1:8080/api/homepage
```

Imposta `ATLAS_TOKEN` nella shell con lo stesso valore del token configurato e adatta host e porta al tuo deploy.

