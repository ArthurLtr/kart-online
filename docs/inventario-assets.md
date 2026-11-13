# Inventário de assets — `referencias/`

Gerado em 2026-11-11, antes de qualquer código de modelo. Total: 23 arquivos (2 modelos 3D, 1 material, 14 texturas, 6 imagens de referência).

## Resumo

| Peça do jogo            | Modelo 3D na pasta | Referência na pasta        | Como será feita                         |
| ----------------------- | ------------------ | -------------------------- | --------------------------------------- |
| Kart                    | Sim (FBX + OBJ)    | —                          | GLB convertido do modelo da pasta       |
| Texturas do kart        | Sim (7 mapas PBR)  | —                          | Mapas da pasta, recomprimidos           |
| Piloto                  | Não                | Sim (6 imagens)            | Procedural seguindo as imagens          |
| Capacete                | Não                | Sim (aparece em 4 imagens) | Procedural seguindo as imagens          |
| Pista e cenário         | Não                | Não                        | Procedural pelo spline — **provisório** |
| Pódio, garagem, efeitos | Não                | Não                        | Procedural — **provisório**             |

## Modelos 3D

| Arquivo                    | Representa         | Formato                       | Tamanho | Geometria                                                                   | Dimensões originais               | Situação                                                             |
| -------------------------- | ------------------ | ----------------------------- | ------- | --------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `Cartoon+Kart+G+-+OBJ.obj` | Kart               | Wavefront OBJ (Blender 3.4.1) | 0,96 MB | 7.492 vértices, 7.281 quads = 14.562 triângulos; 8.965 UVs; 5.987 normais   | 1,222 (X) × 0,775 (Y) × 1,792 (Z) | Fonte da conversão para GLB                                          |
| `Cartoon+Kart+G+-+FBX.fbx` | Kart (mesma malha) | FBX binário 7.4               | 0,41 MB | 1 modelo (`Plane.002`), 1 geometria, 1 material, sem animação nem esqueleto | igual ao OBJ                      | Duplicata do OBJ; fica como reserva                                  |
| `Cartoon+Kart+G+-+OBJ.mtl` | Material do OBJ    | MTL                           | < 1 KB  | 1 material (`mat.002`), cinza genérico                                      | —                                 | Não aponta para nenhuma textura; os mapas serão ligados na conversão |

### Observações do kart

- **Escala:** o comprimento original é 1,792 unidades. Escala uniforme de 1,0324 leva a 1,85 m de comprimento, 1,26 m de largura e 0,80 m de altura. A largura fica abaixo dos ~1,40 m do prompt; não será esticada, porque a regra é não alterar a forma.
- **Malha única:** nos dois arquivos o kart inteiro é um só objeto com um só material. Rodas, volante, carenagem e banco não estão separados.
  - Para as rodas girarem e as dianteiras esterçarem, a conversão precisa separar a malha em partes por ilhas conectadas (sem mexer na forma) e nomeá-las conforme os slots.
  - Slots de cor (livery, aro, faixa do pneu) podem ser feitos trocando ou tingindo o Color Map, já que tudo usa um único atlas de textura.
- **Estilo:** o modelo é cartoon ("Cartoon Kart G"), e o PADRÃO VISUAL do prompt pede realismo sem nada cartunesco. Como a pasta tem prioridade máxima e a forma não pode ser alterada, o kart entra como está; o realismo fica por conta de materiais PBR, iluminação e escala.
- **Eixos e frente:** conferido na conversão. O modelo já vem com a frente para +Z e Y para cima; só o pivô foi movido para o chão, no centro do eixo traseiro.
- **Licença:** não há arquivo de licença na pasta. O FBX guarda o caminho de origem `E:\3D Sellings\Karts\karts.blend`, o que indica asset de marketplace. **Pendente de confirmação do dono do projeto** (regra 7 do prompt).

## Texturas do kart (PBR, um atlas)

Cada mapa existe em 2048 px e 4096 px. O jogo usará a versão 2048 como padrão (meta de carregamento < 15 MB); a 4096 fica para o preset Ultra.

| Mapa          | Tamanho 2048 | Tamanho 4096 | Conteúdo                                                         | Uso                                                                         |
| ------------- | ------------ | ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Color Map     | 0,08 MB      | 0,19 MB      | Pintura azul e preta, número "02", textos "kart" / "racing kart" | `baseColor`; base do slot de livery                                         |
| Normal Map    | 2,82 MB      | 10,84 MB     | Relevo fino                                                      | `normalTexture`                                                             |
| Roughness Map | 0,12 MB      | 0,27 MB      | Variado (dezenas de tons)                                        | Canal G do mapa ORM                                                         |
| Metallic Map  | 0,01 MB      | 0,02 MB      | Áreas chapadas (preto, cinza, branco)                            | Canal B do mapa ORM                                                         |
| AO Map        | 2,38 MB      | 3,73 MB      | Oclusão detalhada                                                | Canal R do mapa ORM                                                         |
| Height Map    | 0,98 MB      | 3,82 MB      | Variação pequena em torno do cinza médio                         | **Não usado**: glTF não tem mapa de altura e o Normal Map já cobre o relevo |
| Emissive Map  | 0,01 MB      | 0,05 MB      | Totalmente preto                                                 | **Não usado**: não emite nada                                               |

## Imagens de referência (não vão para o build)

Todas JPG, 1920 × 1080, cerca de 0,1 MB cada.

| Arquivo                  | Representa        | Conteúdo                                                                                                  |
| ------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `referencia piloto.jpg`  | Piloto + capacete | Corpo inteiro em T-pose, frente e costas; macacão azul-escuro com laranja, capacete azul                  |
| `referencia piloto2.jpg` | Piloto + capacete | Corpo inteiro em T-pose, frente e costas; macacão preto com vermelho e branco, capacete branco e vermelho |
| `referencia piloto3.jpg` | Piloto + capacete | Corpo inteiro em T-pose, frente e costas; macacão azul com branco, capacete branco e azul                 |
| `referencia piloto4.jpg` | Piloto            | Close do busto com balaclava cinza                                                                        |
| `referencia piloto5.jpg` | Piloto            | Close do busto sem capacete                                                                               |
| `referencia piloto6.jpg` | Capacete          | Close do capacete aberto estilo rali, com microfone                                                       |

### Observações do piloto e do capacete

- Servem de alvo para proporções do corpo, corte do macacão (gola, ombreiras, cinto, faixas laterais), luvas, botas e formato do capacete.
- **Marcas reais:** os macacões e capacetes trazem logos de montadoras e patrocinadores reais. Esses logos não serão reproduzidos; o jogo usa padrões de cor equivalentes com marcas fictícias próprias.
- O capacete das imagens é aberto, de rali. O prompt pede casco com viseira curva reflexiva. O procedural seguirá a silhueta e as cores das imagens, com a viseira do prompt.

## Sem modelo e sem referência (provisório)

Pista "Circuito da Orla" (traçado, zebras, guard-rail, brita), arquibancada, boxes, torre, árvores, mar, céu, pódio, garagem e efeitos. Serão gerados por código pelas regras do PADRÃO VISUAL e trocados quando houver modelo ou imagem de referência.

### Piloto e capacete (etapa 3, procedurais a partir das imagens)

Sem modelo 3D na pasta, os dois são gerados por código em `apps/client/src/models/pilot/` e `models/helmet/`, seguindo as seis imagens:

- **Piloto:** proporções de um adulto de 1,76 m, macacão de gola alta com pala nos ombros, cinto, zíper e faixas laterais, luvas de punho largo e botas de cano médio. Os três macacões do catálogo copiam as cores das referências 1, 2 e 3, com marcas fictícias.
- **Capacete:** as cores vêm das referências; a forma é a do prompt (integral, com viseira reflexiva e entrada de ar), não o capacete aberto de rali das imagens.
- **Não reproduzido:** rosto, cabelo e balaclava de perto (referências 4 e 5), porque o piloto do jogo está sempre de capacete fechado.

A garagem (`#garagem`) mostra as imagens ao lado do modelo para comparar. Elas são servidas só pelo servidor de desenvolvimento e não entram no build.

### Pista "Circuito da Orla" (etapa 2, provisória)

Gerada por código a partir do spline em `packages/shared/src/track/`, porque a pasta não tem modelo nem imagem de pista. Tem 1.274 m, 12 m de largura e 8 curvas: curva longa de 180° com banking de 8°, S rápido de quatro curvas, grampo e duas curvas de 180°. Para trocar por um modelo ou seguir uma imagem de traçado, basta colocar o arquivo em `referencias/`.

## Resultado da conversão (`pnpm assets`)

Saída: `apps/client/public/assets/models/kart.glb`, 600 KB, 14.562 triângulos, 1,85 × 1,26 × 0,80 m (comprimento × largura × altura). Geometria comprimida com Meshopt; texturas 2048 em WebP (cor, normal e um mapa ORM com AO, rugosidade e metalicidade).

A malha única foi separada em 25 ilhas conectadas e reagrupada em 8 partes, sem alterar a forma:

| Parte (nó do GLB)      | Triângulos | Pivô           | Uso                                                       |
| ---------------------- | ---------- | -------------- | --------------------------------------------------------- |
| `kart_body`            | 5.698      | origem do kart | Chassi, banco, assoalho, pedais, motor, coluna de direção |
| `fairing`              | 1.644      | origem do kart | Bico e carenagem frontal (slot de carenagem)              |
| `exhaust`              | 1.292      | origem do kart | Dois escapes (slot de escape)                             |
| `steering_wheel`       | 704        | centro do aro  | Gira em torno do eixo gravado em `extras.axis`            |
| `wheel_fl`, `wheel_fr` | 1.306 cada | centro do eixo | Pneu + cubo dianteiros, raio 0,199 m; giram e esterçam    |
| `wheel_rl`, `wheel_rr` | 1.306 cada | centro do eixo | Pneu + cubo traseiros, raio 0,223 m; giram                |

Entre-eixos de 1,114 m. São 8 draw calls por kart (72 com 9 karts).

## Bota, luva e árvores

Convertidos por `node tools/assets/convert.mjs gear trees` (Blender + gltf-transform). Origem e licença dos três pacotes ainda não confirmadas.

| Origem em `referencias/`            | Saída                                        | Triângulos               | Como entra no jogo                                                                                                       |
| ----------------------------------- | -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `shoes/Jane_shoes.obj` (74 mil tri) | `pilot_gear.glb`: `shoe_upper`, `shoe_sole`  | 3.198 + 500 por pé       | Bota de cano alto presa ao pé do piloto; cabedal e sola recebem as cores do cosmético de botas. Sem textura no pacote.   |
| `Gloves_Qa/Gloves_Qa.obj` (172 mil) | `pilot_gear.glb`: `glove_main`, `glove_trim` | 2.400 + 1.200 por mão    | Luva no punho do piloto (a outra mão é espelhada); o tecido principal recebe a cor do cosmético, os painéis são escuros. |
| `arvores/Realistic+Trees+.glb`      | `trees.glb`: `tree_a_*`, `tree_b_*`          | 5.981 e 4.234 por árvore | Vegetação da pista, instanciada (até 180 árvores, 6 draw calls). Texturas reduzidas a 512 px em WebP.                    |

O pacote de árvores traz 6 modelos; só os dois leves entram. Ficaram de fora as duas cerejeiras (3,2 milhões de triângulos cada) e as duas árvores de tronco esculpido (360 e 510 mil), pesadas demais para instanciar no navegador.

## Ferramentas de conversão

Conversão por Blender em linha de comando (OBJ → GLB, escala, pivô, separação e nomeação das partes), seguida de `gltf-transform` (compressão Meshopt e texturas). Texturas em KTX2 dependem do KTX-Software (`toktx`), que não está instalado; sem ele, as texturas saem em WebP.
