# Better Item para Illustrator 0.1.0

Painel de alinhamento e distribuição para o Adobe Illustrator, adaptado do add-on
[Better Item](https://github.com/Borbofruto/Blender-Plugins/tree/main/src/better_item) do Blender.
Funciona com **objetos**, **pontos de ancoragem** e **segmentos**, com referências de
**chave**, **prancheta** e **limites da seleção**, e distribui por **centro de massa** e **até contato**
com a geometria real.

Versão inicial, ainda não validada dentro do Illustrator. Veja "Suposições a confirmar".

## Por que CEP + ExtendScript

O UXP do Illustrator ainda não está aberto a desenvolvedores de fora da Adobe (2026): não há API
pública nem documentação. O caminho público para um painel persistente é o CEP, com ExtendScript
acessando o modelo de objetos (inclusive `pathPoints` e o estado de seleção de cada ponto).
Toda a matemática fica em `host/core.jsx`, em JavaScript puro e sem depender do Illustrator, para
poder migrar para UXP quando ele for liberado.

## Instalar (Windows)

1. Feche o Illustrator.
2. No PowerShell, dentro desta pasta:
   `powershell -ExecutionPolicy Bypass -File install\instalar-windows.ps1`
   (use `-Link` para apontar direto para esta pasta e ver as edições sem reinstalar).
3. Abra o Illustrator e vá em **Janela > Extensões > Better Item**.

O script liga o `PlayerDebugMode` do CEP (necessário para extensões sem assinatura) e copia o
painel para `%APPDATA%\Adobe\CEP\extensions`. No macOS use `sh install/instalar-macos.sh`.
Para depurar o painel, abra `http://localhost:8088` no Chrome com o painel aberto.

## Como usar

**Alvo** define o que se move junto:

| Alvo | Seleção no Illustrator | Unidade |
|---|---|---|
| Objetos | Seleção (V) | cada objeto ou grupo de nível superior |
| Pontos | Seleção Direta (A) | cada ponto de ancoragem selecionado, com as alças |
| Segmentos | Seleção Direta (A) sobre as linhas | cada cadeia contínua de segmentos selecionados |

**Chave**: selecione um objeto, um ponto ou um segmento (conforme o alvo) e clique em
*Definir da seleção*. A chave fica gravada no documento, numa etiqueta invisível do item, e nunca
se move. No alinhamento ela é a referência; na distribuição com espaçamento fixo, ela fica parada
e o resto se arranja em volta dela, como no Better Item.

**Orientação**: os eixos U e V. *Global* é horizontal/vertical. *Ângulo* gira os eixos.
*Segmento-chave* usa a direção do segmento (ou linha) definido como chave. Com isso dá para,
por exemplo, alinhar pontos **sobre a linha** de um segmento: Alvo Pontos, Orientação
Segmento-chave, Referência Chave, Eixo V > Centro.

### Alinhar

- Referência: **limites da seleção**, **prancheta ativa** ou **chave**.
- Base: **limites** (Mín/Centro/Máx na direção do eixo, com as curvas medidas exatamente, sem o
  traço) ou **centro de massa**.

### Distribuir

| Base | O que fica igual |
|---|---|
| Centros dos limites | a distância entre os centros das caixas |
| Centro de massa (superfície) | a distância entre os centroides das áreas preenchidas |
| Vão entre limites | o vão entre as caixas projetadas na direção |
| Até contato (geometria real) | o vão entre os contornos de verdade, medido na direção |

- **Espaçamento fixo**: intervalo ou vão com o valor dado (pt, mm ou px). Com 0 e *Até contato*,
  os itens se encostam pelos contornos reais. A chave, se selecionada, fica parada; sem chave,
  o primeiro item na direção fica parado.
- **Entre extremos**: as pontas ficam no lugar (ou encostam nas bordas da prancheta) e os vãos
  ficam iguais.
- **Medir** mostra o espaçamento atual, uniforme ou misto, sem mover nada.

A ordem é a posição ao longo da direção. Itens empatados são recusados com uma mensagem, em vez de
uma ordem inventada.

## Como a geometria é calculada

- **Limites**: extensão exata das Béziers cúbicas projetadas no eixo (raízes da derivada), em
  qualquer ângulo. Não é a caixa do Illustrator girada.
- **Centro de massa**: teorema de Green com quadratura de Gauss-Legendre de 5 pontos, exato para
  cúbicas. Caminhos compostos usam par-ímpar (furos descontam área). Grupos somam as áreas das
  partes. Grupos com máscara usam só o caminho de recorte. Textos são convertidos em contornos
  temporários para medir os glifos. Sem área preenchida, vale o centroide do traço e, por último,
  o centro dos limites. Imagens e outros itens usam o retângulo dos limites.
- **Até contato**: os contornos viram polilinhas com desvio de no máximo 0,02 pt. O vão é a
  menor distância que o item de trás percorre na direção até tocar o da frente (raios de cada
  vértice contra os segmentos do outro, nos dois sentidos). Como os itens só se movem nessa
  direção, o vão muda exatamente pelo deslocamento, então a distribuição sai em uma passada, sem
  iteração. Se dois itens nunca se tocariam naquela direção, o par usa o vão entre limites e o
  painel avisa.

## Testes

`npm test` roda o núcleo geométrico (círculos, formas em L, furos, contato entre círculos e
triângulos, chave, prancheta, direção girada) e a ponte `host.jsx` contra um DOM simulado do
Illustrator. Os dois arquivos `.jsx` também passam por um parser ES3, como o ExtendScript exige.

## Suposições a confirmar no Illustrator

1. **Segmentos selecionados**: o script não informa segmentos diretamente. Um segmento conta
   como selecionado quando os seus dois pontos têm algum estado de seleção (âncora ou alça).
2. **Desfazer**: espero que cada clique vire um único passo de Ctrl+Z, mas isso depende de como o
   Illustrator agrupa o `evalScript`.
3. **Traço**: limites e contato usam o caminho, sem a espessura do traço. Dá para adicionar a
   opção "limites visíveis" depois.
4. **Regra de preenchimento**: compostos com regra diferente de zero e furos no mesmo sentido
   ficam como par-ímpar.
5. Movimento de objetos via `position` e de pontos via `anchor`/alças, no sistema de coordenadas
   do documento (Y para cima), restaurado depois de cada ação.

## Estrutura

```
CSXS/manifest.xml     manifesto CEP (Illustrator 26+)
client/               painel (HTML/CSS/JS)
host/core.jsx         geometria pura (ES3, testável em Node)
host/host.jsx         ponte com o DOM do Illustrator
install/              scripts de instalação para Windows e macOS
tests/                testes do núcleo e da ponte
```

Licença GPL-3.0-or-later, a mesma do Better Item.
