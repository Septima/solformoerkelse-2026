# Solformørkelses-klient

Dette repository indeholder en klient til SkyggeWMS servicen, der findes her: https://github.com/Septima/skyggewms




## Installation

Dette kræver at [NodeJS](https://nodejs.org/en/download) samt [Yarn](https://yarnpkg.com/getting-started/install) er installeredet på maskinen. Kør derefter:
```
yarn
```

## Test lokalt

Kør følgende for at teste lokalt
```
yarn start
```
Gå til http://127.0.0.1:9003/ for at se indholdet i html mappen

## Deploy

Alt hvad der ligger i html mappen, udstilles på https://septima.dk/solformoerkelse-2026. Ændringer kommer ikke med ud automatisk, men sker ved at køre følgende:
```
yarn deploy
```
