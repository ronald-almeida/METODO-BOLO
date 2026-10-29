# Checkout Formação Bauer

Checkout responsivo com os arquivos originais do banner e logo, preço único de **R$ 197,70**, geração de Pix pela Black Cat e pop-up com QR Code, código copia e cola e consulta de pagamento.

## Executar

Requer Node.js 22 ou superior. Não há dependências para instalar nem etapa de build.

1. Copie `.env.example` para `.env`.
2. Preencha `BLACKCAT_API_KEY` com a chave do painel Black Cat.
3. Execute `npm start` (ou `node --env-file-if-exists=.env server.mjs`).
4. Abra `http://localhost:3000`.

Sem a chave, a página abre normalmente e a geração de Pix informa indisponibilidade. Não existe Pix fictício nem modo de simulação na aplicação.

## Publicar

Use uma hospedagem com Node.js 22+, como um serviço web ou um container. Configure o comando de início `npm start`, a variável privada `BLACKCAT_API_KEY` e `APP_ORIGIN` com a URL HTTPS final. A porta é lida de `PORT` (padrão 3000). O `Dockerfile` também pode ser usado. Configure HTTPS no provedor.

Este repositório inclui um backend: GitHub Pages ou uma hospedagem somente estática não executam a integração de pagamento. Nunca coloque a chave no HTML, JavaScript público, Dockerfile ou em arquivos versionados.

## Fluxo sem banco de dados

- O servidor valida nome, email, telefone e os dígitos verificadores do CPF/CNPJ.
- `POST /api/pix` cria a venda em `https://api.blackcatoficial.com/api/sales/create-sale` com o cabeçalho `X-API-Key`.
- O valor é fixado no servidor em **19770 centavos**, com quantidade 1 e produto digital.
- O pop-up recebe `paymentData.copyPaste` (ou `qrCode`), `qrCodeBase64` e `expiresAt`. Se a imagem estiver ausente, o código copia e cola continua disponível.
- O Pix fica somente na memória da página. Fechar e reabrir o pop-up reutiliza o mesmo código. Recarregar ou fechar a página descarta essa sessão local.
- A consulta ocorre a cada 10 segundos enquanto o pop-up está aberto e a aba visível, ou pelo botão “Já paguei”. O servidor consulta `/sales/{transactionId}/status` com um token assinado, sem salvar o ID. A assinatura usa a chave privada e expira em 48 horas.
- Não há banco de dados, localStorage, sessionStorage, cookies de pagamento, webhook, armazenamento em arquivo ou logs de dados pessoais no código. A Black Cat registra a venda no próprio serviço para processar o pagamento.
- Cliques simultâneos são bloqueados e o Pix existente é reutilizado na mesma página. Sem persistência e sem uma chave de idempotência documentada pela Black Cat, não há deduplicação entre abas, recargas ou tentativas após uma falha de rede.
- A confirmação exibe o pagamento recebido. Entrega do curso/email/acesso à área de membros não faz parte desta integração.

## Aparência

Banner e logo em `public/assets/`. Estilos em `public/styles.css`. A fonte provisória é Arial/Helvetica, pois o nome ou arquivo da fonte solicitada não veio na mensagem. O topo usa uma mensagem de oferta sem inventar um prazo de expiração comercial. O vencimento real do Pix vem da Black Cat.

## Verificar

Execute `npm test` ou `node --test`. Os testes usam respostas controladas em memória; não geram cobranças reais. Cobrem validação, valor fixo, autenticação privada, mapeamento da API, assinatura e expiração do token, erros e fluxo HTTP.

A validação real com a Black Cat exige configurar a chave e realizar uma transação autorizada. O código foi implementado a partir de [docs.blackcatoficial.com](https://docs.blackcatoficial.com/).
