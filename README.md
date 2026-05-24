# Gestao QR IVA

PWA mobile-first para gestao pessoal de faturas portuguesas por QR Code, lancamentos manuais e controlo estimado de IVA.

## Funcionalidades do MVP

- Dashboard mensal com entradas, saidas, saldo, resultado sem IVA, IVA liquidado, IVA suportado e IVA a pagar/receber.
- Leitura de QR Code via camera quando o navegador suporta `BarcodeDetector`.
- Campo para colar o conteudo bruto do QR Code quando a leitura direta nao estiver disponivel.
- Lancamento manual de despesas sem QR Code, como guia de IVA, coimas e outros documentos.
- Classificacao automatica por NIF proprio: se o NIF emitente for o seu NIF, sugere faturamento; caso contrario, despesa.
- Deteccao de duplicados por NIF emitente, tipo, numero, data e total.
- Historico com filtros e exportacao CSV.
- Dados guardados localmente no navegador com suporte offline via service worker.

## Como abrir localmente

Por ser uma app estatica, pode abrir `index.html` no navegador. Para testar service worker, camera e instalacao PWA, use um servidor local:

```powershell
python -m http.server 8080
```

Depois aceda a `http://localhost:8080`.

## Deploy por link

Pode publicar a pasta em Render Static Site, Firebase Hosting, Vercel ou GitHub Pages. A app nao precisa de backend nesta fase.

Para uso real da camera em telemovel, publique em HTTPS.

## Firebase Hosting

O projeto ja inclui `firebase.json` e `.firebaserc`.

1. Instale ou use a CLI:

```powershell
npm install -g firebase-tools
```

2. Entre na conta:

```powershell
firebase login
```

3. Crie o projeto no Firebase Console com o ID `gestao-qr-iva`, ou altere `.firebaserc` para o ID escolhido.

4. Publique:

```powershell
firebase deploy --only hosting
```

## Render Static Site

O projeto ja inclui `render.yaml`.

1. Coloque esta pasta num repositorio GitHub.
2. No Render, escolha New > Static Site.
3. Conecte o repositorio.
4. Use:

- Build Command: vazio
- Publish Directory: `.`
- Runtime: Static

O Render vai publicar em HTTPS, entao a camera do telemovel podera pedir permissao normalmente.
