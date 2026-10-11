/* TornoLab CNC · dados.js
   Máquina, ferramentas, materiais, programas-exemplo e dicionário de códigos.
   Convenção geométrica: plano (z, r). z = eixo do torno (+ para a contraponta),
   r = raio (+ para cima). X no programa é sempre DIÂMETRO. */
window.CNC = window.CNC || {};
(function (CNC) {
  'use strict';

  const RAD = Math.PI / 180;
  const arred = (n) => Math.round(n * 1000) / 1000;

  /* Losango com a ponta na origem. a1 e a2 = direção das duas arestas
     que saem da ponta (graus a partir de +Z, sentido anti-horário). */
  function losango(a1, a2, lado) {
    const u = [Math.cos(a1 * RAD), Math.sin(a1 * RAD)];
    const v = [Math.cos(a2 * RAD), Math.sin(a2 * RAD)];
    return [
      [0, 0],
      [arred(v[0] * lado), arred(v[1] * lado)],
      [arred((u[0] + v[0]) * lado), arred((u[1] + v[1]) * lado)],
      [arred(u[0] * lado), arred(u[1] * lado)]
    ];
  }

  CNC.MAQUINA = {
    rpmMax: 4000,        // rotação máxima do eixo-árvore
    rapido: 12000,       // avanço rápido (mm/min)
    tempoTroca: 1.2,     // tempo de giro da torre (s)
    xMin: -40            // curso mínimo em X (diâmetro)
  };

  CNC.PLACA = { castanhaL: 18, castanhaH: 14, castanhaLarg: 16, corpoL: 46, corpoFolga: 12 };

  CNC.MATERIAIS = {
    aco1045: { nome: 'Aço SAE 1045', vcMD: [150, 250], vcHSS: [18, 28], cor: [170, 180, 192], cavaco: ['#d2a85a', '#6a7fc4', '#9aa4b2', '#b98a4a'] },
    aco1020: { nome: 'Aço SAE 1020', vcMD: [180, 300], vcHSS: [22, 35], cor: [176, 184, 194], cavaco: ['#d8b066', '#7086c8', '#a4adb9'] },
    aluminio: { nome: 'Alumínio 6351', vcMD: [300, 900], vcHSS: [60, 150], cor: [208, 215, 222], cavaco: ['#eef2f5', '#c6cfd7', '#dfe5ea'] },
    latao: { nome: 'Latão', vcMD: [200, 400], vcHSS: [50, 90], cor: [214, 184, 102], cavaco: ['#f0cf72', '#c9a245', '#e2bb5c'] },
    nylon: { nome: 'Poliamida (náilon)', vcMD: [200, 500], vcHSS: [100, 250], cor: [226, 222, 206], cavaco: ['#f4f1e6', '#dcd6c2'] }
  };

  /* corte: polígonos CONVEXOS que removem material.
     corpo: suporte/haste — não corta, só colide. */
  CNC.FERRAMENTAS = {
    1: {
      num: 1, nome: 'Desbaste externo', tipo: 'externa', md: true,
      inserto: 'CNMG 120408 · losango 80°', suporte: 'PCLNR 2525 M12', raio: 0.8,
      f: [0.2, 0.4], ref: 'Ponta teórica do inserto',
      uso: 'Faceamento e desbaste longitudinal (G71, G72, G90, G94).',
      cor: '#d9ae45',
      corte: [losango(85, 5, 12)],
      corpo: [[[1.5, 10], [26, 10], [26, 58], [1.5, 58]]]
    },
    2: {
      num: 2, nome: 'Acabamento externo', tipo: 'externa', md: true,
      inserto: 'VNMG 160404 · losango 35°', suporte: 'SVJNR 2525 M16', raio: 0.4,
      f: [0.08, 0.2], ref: 'Ponta teórica do inserto',
      uso: 'Perfis com raios e cones (G70, G01, G02, G03).',
      cor: '#e6c35c',
      corte: [losango(87, 52, 12)],
      corpo: [[[1.5, 14], [20, 14], [20, 58], [1.5, 58]]]
    },
    3: {
      num: 3, nome: 'Bedame de canal 3 mm', tipo: 'canal', md: true, larg: 3,
      inserto: 'Pastilha de canal 3 mm', suporte: 'Lâmina 26 mm', raio: 0.2,
      f: [0.04, 0.1], ref: 'Canto ESQUERDO da lâmina (lado da placa)',
      uso: 'Canais, alívios e saída de rosca (G75, G01).',
      cor: '#cfa646',
      corte: [[[0, 0], [3, 0], [3, 14], [0, 14]]],
      corpo: [[[-2, 14], [7, 14], [7, 58], [-2, 58]]]
    },
    4: {
      num: 4, nome: 'Rosca externa 60°', tipo: 'rosca', md: true,
      inserto: '16ER AG60 · perfil parcial 60°', suporte: 'SER 2525 M16', raio: 0.05,
      f: null, ref: 'Ponta do perfil de 60°',
      uso: 'Roscas métricas externas (G76, G92, G32).',
      cor: '#d6a83e',
      corte: [[[0, 0], [3.46, 6], [3.46, 10], [-3.46, 10], [-3.46, 6]]],
      corpo: [[[-5, 10], [6, 10], [6, 58], [-5, 58]]]
    },
    5: {
      num: 5, nome: 'Broca helicoidal Ø18', tipo: 'broca', md: false, diam: 18,
      inserto: 'Aço rápido (HSS) · ponta 118°', suporte: 'Porta-broca cone Morse', raio: 0,
      f: [0.08, 0.2], ref: 'Ponta da broca, no centro (X0)',
      uso: 'Furação no centro da peça (G74, G01).',
      cor: '#b8c2cc',
      corte: [[[0, 0], [5.41, 9], [90, 9], [90, -9], [5.41, -9]]],
      corpo: [[[90, -16], [130, -16], [130, 16], [90, 16]]]
    },
    6: {
      num: 6, nome: 'Barra de mandrilar', tipo: 'interna', md: true, minFuro: 17,
      inserto: 'CCMT 060204 · losango 80°', suporte: 'Barra Ø12 · S12M-SCLCR', raio: 0.4,
      f: [0.08, 0.25], ref: 'Ponta teórica do inserto',
      uso: 'Torneamento interno (G71/G70 com U negativo).',
      cor: '#d9ae45',
      corte: [losango(-85, -5, 7)],
      corpo: [[[4, -1.5], [150, -1.5], [150, -13], [4, -13]]]
    },
    7: {
      num: 7, nome: 'Bedame de corte 3 mm', tipo: 'canal', md: true, larg: 3,
      inserto: 'Pastilha de sangrar 3 mm', suporte: 'Lâmina 32 mm', raio: 0.2,
      f: [0.03, 0.08], ref: 'Canto ESQUERDO da lâmina (lado da placa)',
      uso: 'Separar a peça da barra (sangramento).',
      cor: '#cfa646',
      corte: [[[0, 0], [3, 0], [3, 30], [0, 30]]],
      corpo: [[[-2, 30], [7, 30], [7, 62], [-2, 62]]]
    },
    8: {
      num: 8, nome: 'Broca de centro A2,5', tipo: 'broca', md: false, diam: 6.3,
      inserto: 'HSS · DIN 333 A2,5 (60°)', suporte: 'Mandril', raio: 0,
      f: [0.05, 0.12], ref: 'Ponta, no centro (X0)',
      uso: 'Furo de centro antes da broca helicoidal.',
      cor: '#b8c2cc',
      corte: [
        [[0, 0], [0.75, 1.25], [3, 1.25], [3, -1.25], [0.75, -1.25]],
        [[3, 1.25], [6.29, 3.15], [40, 3.15], [40, -3.15], [6.29, -3.15], [3, -1.25]]
      ],
      corpo: [[[40, -14], [80, -14], [80, 14], [40, 14]]]
    }
  };

  /* ---------------- Programas-exemplo ---------------- */
  CNC.EXEMPLOS = [
    {
      id: 'ex01', titulo: '01 · Faceamento e torneamento (G00/G01)',
      bruta: { d: 50, l: 70, face: 1, furo: 0, mat: 'aco1045' },
      objetivo: 'Primeiro programa: faceamento e passes longitudinais escritos bloco a bloco. Cada passe entra em <b>G00</b> fora da peça e corta em <b>G01</b>. Repare que X é sempre <b>diâmetro</b> e que Z0 é a face da peça.',
      codigo: `%
O0001 (FACEAMENTO E TORNEAMENTO)
(BRUTA: D50 X 70 EM BALANCO - ACO 1045)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G50 S2500
N50 G96 S180 M03
N60 G00 X54. Z0. M08
N70 G01 X-1.6 F0.2 (FACEAMENTO)
N80 G00 Z2.
N90 X46.
N100 G01 Z-40. F0.25 (PASSE 1)
N110 X52.
N120 G00 Z2.
N130 X42.
N140 G01 Z-40. (PASSE 2)
N150 X52.
N160 G00 Z2.
N170 X38.
N180 G01 Z-25. (PASSE 3)
N190 X52.
N200 G00 Z2.
N210 X34.
N220 G01 Z0. F0.15
N230 X38. Z-2. (CHANFRO 2X45)
N240 G00 X100. Z100. M09
N250 M05
N260 M30
%`
    },
    {
      id: 'ex02', titulo: '02 · Ciclos G94/G90 e raios G02/G03',
      bruta: { d: 40, l: 60, face: 1, furo: 0, mat: 'aco1045' },
      objetivo: 'Ciclos fixos simples: <b>G94</b> faceia e <b>G90</b> torneia em “retângulos”. As linhas seguintes com só X/Z repetem o ciclo. No acabamento, <b>G02</b> faz o raio côncavo e <b>G03</b> o raio convexo (torre traseira, X para cima).',
      codigo: `%
O0002 (CICLOS G94 G90 E PERFIL COM RAIOS)
(BRUTA: D40 X 60 EM BALANCO)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G50 S3000
N50 G96 S200 M03
N60 G00 X42. Z2. M08
(G94 - CICLO DE FACEAMENTO)
N70 G94 X-1.6 Z0. F0.2
(G90 - CICLO DE TORNEAMENTO EM VARIOS PASSES)
N80 G90 X38.5 Z-44.8 F0.25
N90 X34.5 Z-29.8
N100 X30.5 Z-14.8
N110 X26.5
N120 X22.5 Z-11.8
N130 X20.5
N140 G00 X100. Z100.
N150 T0202 (ACABAMENTO 35 GRAUS)
N160 G96 S250 M03
N170 G00 X16. Z1.
N180 G01 X20. Z-1. F0.12 (CHANFRO)
N190 Z-12.
N200 G02 X26. Z-15. R3. (RAIO CONCAVO)
N210 G01 X30.
N220 G03 X34. Z-17. R2. (RAIO CONVEXO)
N230 G01 Z-30.
N240 X38. Z-40. (CONE)
N250 Z-45.
N260 X42.
N270 G00 X100. Z100. M09
N280 M05
N290 M30
%`
    },
    {
      id: 'ex03', titulo: '03 · Desbaste G71 e acabamento G70',
      bruta: { d: 50, l: 80, face: 1, furo: 0, mat: 'aco1045' },
      objetivo: 'Desbaste automático: o <b>G71</b> calcula sozinho os passes a partir do perfil N110–N200, deixando sobremetal U0.4 (diâmetro) e W0.1. A ferramenta de acabamento repete o mesmo perfil com <b>G70</b>. Compare o tamanho deste programa com o exemplo 01.',
      codigo: `%
O0003 (EIXO - DESBASTE G71 E ACABAMENTO G70)
(BRUTA: D50 X 80 EM BALANCO)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G50 S2500
N50 G96 S200 M03
N60 G00 X54. Z0. M08
N70 G01 X-1.6 F0.2 (FACEAMENTO)
N80 G00 X52. Z2.
N90 G71 U2. R0.5
N100 G71 P110 Q200 U0.4 W0.1 F0.28
N110 G00 X16.
N120 G01 Z0. F0.12
N130 X20. Z-2.
N140 Z-15.
N150 G02 X26. Z-18. R3.
N160 G01 X32.
N170 X38. Z-35.
N180 Z-45.
N190 G03 X46. Z-49. R4.
N200 G01 X52.
N210 G00 X100. Z100.
N220 T0202 (ACABAMENTO)
N230 G96 S250 M03
N240 G00 X52. Z2.
N250 G70 P110 Q200
N260 G00 X100. Z100. M09
N270 M05
N280 M30
%`
    },
    {
      id: 'ex04', titulo: '04 · Canais G75 e sangramento',
      bruta: { d: 40, l: 60, face: 0, furo: 0, mat: 'aco1045' },
      objetivo: 'O bedame tem a referência no <b>canto esquerdo</b> da lâmina: em Z-8 o canal vai de Z-8 a Z-5. Canal simples com G01 + <b>G04</b> (permanência) e canal largo com <b>G75</b> (P e Q em micrômetros). No fim, o bedame de corte separa a peça da barra.',
      codigo: `%
O0004 (CANAIS COM G75 E SANGRAMENTO)
(BRUTA: D40 X 60, JA FACEADA)
(BEDAME: REFERENCIA NO CANTO ESQUERDO)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0303 (BEDAME DE CANAL 3 MM)
N40 G97 S700 M03
N50 G00 X44. Z-8. M08
(CANAL SIMPLES: UMA LARGURA DE LAMINA)
N60 G01 X32. F0.06
N70 G04 X0.5 (PERMANENCIA NO FUNDO)
N80 G00 X44.
(CANAL LARGO COM G75: DE Z-18 ATE Z-24)
N90 G00 Z-18.
N100 G75 R0.5
N110 G75 X30. Z-24. P1500 Q2500 F0.06
N120 G00 X100. Z100.
N130 T0707 (BEDAME DE CORTE 3 MM)
N140 G97 S600 M03
N150 G00 X44. Z-38.
N160 G75 R1.
N170 G75 X-0.5 P3000 F0.05 (SANGRAMENTO)
N180 G00 X100. Z100. M09
N190 M05
N200 M30
%`
    },
    {
      id: 'ex05', titulo: '05 · Rosca M24×2 com G76',
      bruta: { d: 30, l: 60, face: 1, furo: 0, mat: 'aco1045' },
      objetivo: 'Rosca métrica M24×2: altura do filete h = 0,6134 × P = <b>1,227 mm</b> (P1227), diâmetro do núcleo 24 − 2h = <b>21,55 mm</b>. O canal de saída é feito antes. A cada passe do <b>G76</b> a ferramenta entra pelo flanco e a profundidade diminui (Q400 = 0,4 mm no 1º passe).',
      codigo: `%
O0005 (ROSCA M24X2 COM G76)
(BRUTA: D30 X 60 EM BALANCO)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G50 S3000
N50 G96 S200 M03
N60 G00 X34. Z0. M08
N70 G01 X-1.6 F0.2
N80 G00 X32. Z2.
N90 G90 X27. Z-35. F0.25
N100 X24.8
N110 G00 X100. Z100.
N120 T0202 (ACABAMENTO)
N130 G96 S250 M03
N140 G00 X19.8 Z1.
N150 G01 X23.8 Z-1. F0.1 (CHANFRO)
N160 Z-35.
N170 X32.
N180 G00 X100. Z100.
N190 T0303 (BEDAME - CANAL DE SAIDA)
N200 G97 S700 M03
N210 G00 X32. Z-33.
N220 G01 X20. F0.06
N230 G00 X32.
N240 G00 X100. Z100.
N250 T0404 (ROSCA 60 GRAUS)
N260 G97 S600 M03
N270 G00 X28. Z6.
N280 G76 P020060 Q100 R0.05
N290 G76 X21.55 Z-31. P1227 Q400 F2.
N300 G00 X100. Z100. M09
N310 M05
N320 M30
%`
    },
    {
      id: 'ex06', titulo: '06 · Furação G74 e torneamento interno',
      bruta: { d: 50, l: 50, face: 1, furo: 0, mat: 'aco1045' },
      objetivo: 'Operações internas: broca de centro, furação com quebra-cavaco <b>G74</b> (Q8000 = bicadas de 8 mm) e torneamento interno com <b>G71/G70</b>. No interno o sobremetal U é <b>negativo</b> e o ponto de partida fica dentro do furo (X17).',
      codigo: `%
O0006 (FURACAO G74 E TORNEAMENTO INTERNO)
(BRUTA: D50 X 50 EM BALANCO)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G50 S2500
N50 G96 S200 M03
N60 G00 X54. Z0. M08
N70 G01 X-1.6 F0.2 (FACEAMENTO)
N80 G00 X100. Z100.
N90 T0808 (BROCA DE CENTRO)
N100 G97 S1500 M03
N110 G00 X0. Z3.
N120 G01 Z-5. F0.08
N130 G00 Z3.
N140 G00 X100. Z100.
N150 T0505 (BROCA D18)
N160 G97 S450 M03
N170 G00 X0. Z5.
N180 G74 R1.
N190 G74 Z-35. Q8000 F0.12
N200 G00 X100. Z100.
N210 T0606 (BARRA DE MANDRILAR)
N220 G50 S2000
N230 G96 S180 M03
N240 G00 X17. Z2.
N250 G71 U1.5 R0.5
N260 G71 P270 Q330 U-0.4 W0.1 F0.2
N270 G00 X32.
N280 G01 Z0. F0.1
N290 X30. Z-1.
N300 Z-15.
N310 X24.
N320 Z-30.
N330 X17.
N340 G70 P270 Q330
N350 G00 Z5.
N360 G00 X100. Z100. M09
N370 M05
N380 M30
%`
    },
    {
      id: 'ex07', titulo: '07 · Exercício: encontre os 4 erros',
      bruta: { d: 50, l: 50, face: 1, furo: 0, mat: 'aco1045' },
      objetivo: 'Este programa tem <b>4 erros</b>. Execute, leia o alarme, corrija a linha indicada, pressione RESET e execute de novo, até usinar a peça inteira.<details class="gabarito"><summary>Ver gabarito</summary><ol><li>Falta ligar o eixo-árvore: inclua <code>G50 S2500</code> e <code>G96 S200 M03</code> antes do N40.</li><li>N120 entra no material em rápido: troque por <code>G01 Z-20.</code></li><li>N170: o raio não fecha. Use <code>G03 X42. Z-3. R3.</code></li><li>N200 bate na placa (castanhas em Z-50): use <code>Z-45.</code></li></ol></details>',
      codigo: `%
O0007 (EXERCICIO - ENCONTRE OS 4 ERROS)
(EXECUTE, LEIA O ALARME, CORRIJA E RODE DE NOVO)
(BRUTA: D50 X 50 EM BALANCO)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G00 X54. Z0. M08
N50 G01 X-1.6 F0.2
N60 G00 Z2.
N70 X46.
N80 G01 Z-30. F0.25
N90 X52.
N100 G00 Z2.
N110 X42.
N120 Z-20.
N130 G01 X46.
N140 G00 Z2.
N150 X36.
N160 G01 Z0. F0.15
N170 G03 X42. Z-3. R2.
N180 G01 Z-20.
N190 X46.
N200 Z-60.
N210 X52.
N220 G00 X100. Z100. M09
N230 M05
N240 M30
%`
    },
    {
      id: 'ex08', titulo: '08 · Flange com desbaste G72',
      bruta: { d: 80, l: 30, face: 1, furo: 0, mat: 'aco1020' },
      objetivo: 'Peça curta e de diâmetro grande: o <b>G72</b> desbasta no sentido transversal, com passes de faceamento de W2 mm. O perfil começa movendo só em Z (N90) e termina no centro da face.',
      codigo: `%
O0008 (FLANGE - DESBASTE TRANSVERSAL G72)
(BRUTA: D80 X 30 EM BALANCO - ACO 1020)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G50 S2000
N50 G96 S180 M03
N60 G00 X84. Z2. M08
N70 G72 W2. R0.5
N80 G72 P90 Q160 U0.4 W0.2 F0.25
N90 G00 Z-13.
N100 G01 X80. F0.12
N110 X78. Z-12.
N120 X46.
N130 G03 X40. Z-9. R3.
N140 G01 Z-1.
N150 X38. Z0.
N160 X0.
N170 G00 X100. Z100.
N180 T0202 (ACABAMENTO)
N190 G96 S250 M03
N200 G00 X84. Z2.
N210 G70 P90 Q160
N220 G00 X100. Z100. M09
N230 M05
N240 M30
%`
    },
    {
      id: 'modelo', titulo: '09 · Programa em branco (modelo)',
      bruta: { d: 50, l: 70, face: 1, furo: 0, mat: 'aco1045' },
      objetivo: 'Cabeçalho de segurança pronto. Escreva a usinagem entre N60 e N900. Use a aba <b>Códigos</b> para inserir modelos de ciclos.',
      codigo: `%
O1000 (MEU PROGRAMA)
(BRUTA: D50 X 70 EM BALANCO)
N10 G21 G40 G99
N20 G28 U0. W0.
N30 T0101 (DESBASTE EXTERNO)
N40 G50 S2500
N50 G96 S200 M03
N60 G00 X54. Z2. M08
(ESCREVA AQUI A USINAGEM)

N900 G00 X100. Z100. M09
N910 M05
N920 M30
%`
    }
  ];

  /* ---------------- Dicionário de códigos ---------------- */
  CNC.CODIGOS = [
    { grupo: 'Movimentos', itens: [
      { c: 'G00', t: 'Avanço rápido', d: 'Posiciona na velocidade máxima, sem cortar. Nunca use dentro do material.', ex: 'G00 X52. Z2.' },
      { c: 'G01', t: 'Interpolação linear', d: 'Reta com avanço de corte F: tornear, facear, chanfrar e fazer cones.', ex: 'G01 Z-40. F0.25' },
      { c: 'G02', t: 'Arco horário', d: 'Arco no sentido horário (torre traseira, X para cima). Raio por R, ou centro por I (em raio) e K.', ex: 'G02 X26. Z-18. R3.' },
      { c: 'G03', t: 'Arco anti-horário', d: 'Arco anti-horário. Ao tornear em direção à placa, é o raio convexo.', ex: 'G03 X46. Z-49. R4.' },
      { c: 'G04', t: 'Permanência', d: 'Para o avanço no ponto atual. X ou U em segundos; P em milissegundos.', ex: 'G04 X0.5' },
      { c: 'G28', t: 'Retorno à referência', d: 'Leva os eixos ao ponto de referência da máquina. “G28 U0. W0.” vai direto, sem ponto intermediário.', ex: 'G28 U0. W0.' },
      { c: 'G32', t: 'Roscamento passo a passo', d: 'Movimento sincronizado com o eixo-árvore. F é o passo da rosca.', ex: 'G32 Z-30. F2.' }
    ] },
    { grupo: 'Ciclos fixos', itens: [
      { c: 'G70', t: 'Ciclo de acabamento', d: 'Executa o perfil entre os blocos P e Q usando o F e o S escritos no perfil.', ex: 'G70 P110 Q200' },
      { c: 'G71', t: 'Desbaste longitudinal', d: '1ª linha: U = profundidade por passe (raio) e R = recuo. 2ª linha: P/Q = blocos do perfil, U = sobremetal em X (diâmetro; negativo no interno), W = sobremetal em Z, F = avanço.', ex: 'G71 U2. R0.5\nG71 P110 Q200 U0.4 W0.1 F0.28' },
      { c: 'G72', t: 'Desbaste transversal', d: 'Como o G71, mas com passes de faceamento. 1ª linha: W = profundidade por passe em Z.', ex: 'G72 W2. R0.5\nG72 P90 Q160 U0.4 W0.2 F0.25' },
      { c: 'G74', t: 'Furação com quebra-cavaco', d: '1ª linha: R = recuo. 2ª linha: Z = fundo do furo, Q = profundidade de cada bicada em µm (Q8000 = 8 mm).', ex: 'G74 R1.\nG74 Z-35. Q8000 F0.12' },
      { c: 'G75', t: 'Ciclo de canais', d: '1ª linha: R = recuo. 2ª linha: X = fundo do canal, Z = posição final, P = penetração por bicada (µm, raio), Q = deslocamento em Z (µm).', ex: 'G75 R0.5\nG75 X30. Z-24. P1500 Q2500 F0.06' },
      { c: 'G76', t: 'Ciclo de roscamento', d: '1ª linha: P mm rr aa (passes finais, saída, ângulo), Q = profundidade mínima (µm), R = sobremetal final. 2ª linha: X = diâmetro do núcleo, Z = fim da rosca, P = altura do filete (µm), Q = 1º passe (µm), F = passo.', ex: 'G76 P020060 Q100 R0.05\nG76 X21.55 Z-31. P1227 Q400 F2.' },
      { c: 'G90', t: 'Ciclo de torneamento', d: 'Entra em X, torneia até Z, sai em X e volta. Linhas seguintes com só X/Z repetem o ciclo. R = conicidade (raio).', ex: 'G90 X46. Z-40. F0.25' },
      { c: 'G92', t: 'Roscamento simples', d: 'Um passe de rosca por linha. As linhas seguintes com X menor fazem os próximos passes.', ex: 'G92 X23.2 Z-31. F2.' },
      { c: 'G94', t: 'Ciclo de faceamento', d: 'Entra em Z, faceia até X, sai em Z e volta ao ponto inicial.', ex: 'G94 X-1.6 Z0. F0.2' }
    ] },
    { grupo: 'Configuração', itens: [
      { c: 'G20', t: 'Polegadas', d: 'Aceito, mas o simulador trabalha sempre em milímetros.', ex: 'G20' },
      { c: 'G21', t: 'Milímetros', d: 'Unidade padrão do simulador.', ex: 'G21' },
      { c: 'G40', t: 'Cancela compensação de raio', d: 'Programa a ponta teórica da ferramenta.', ex: 'G40' },
      { c: 'G41', t: 'Compensação à esquerda', d: 'Aceita, mas não simulada.', ex: 'G41' },
      { c: 'G42', t: 'Compensação à direita', d: 'Aceita, mas não simulada: o desenho mostra a ponta teórica.', ex: 'G42' },
      { c: 'G50', t: 'Limite de rotação', d: 'Com S, limita a rotação em G96. Programe antes de ligar o eixo em velocidade de corte constante.', ex: 'G50 S2500' },
      { c: 'G54', t: 'Zero-peça', d: 'Sistema de coordenadas da peça. Aqui o zero fica no centro da face acabada. G55 a G59 são aceitos.', ex: 'G54' },
      { c: 'G96', t: 'Velocidade de corte constante', d: 'S passa a ser Vc em m/min. A rotação muda com o diâmetro: n = 1000·Vc ÷ (π·D).', ex: 'G96 S200 M03' },
      { c: 'G97', t: 'Rotação constante', d: 'S em rpm. Use em furação, canais e roscas.', ex: 'G97 S800 M03' },
      { c: 'G98', t: 'Avanço por minuto', d: 'F em mm/min.', ex: 'G98' },
      { c: 'G99', t: 'Avanço por rotação', d: 'F em mm/rot. É o padrão nos tornos.', ex: 'G99' }
    ] },
    { grupo: 'Funções M', itens: [
      { c: 'M00', t: 'Parada programada', d: 'Para o programa até apertar Ciclo início.', ex: 'M00' },
      { c: 'M01', t: 'Parada opcional', d: 'Só para se a chave “Parada opcional” estiver ligada.', ex: 'M01' },
      { c: 'M03', t: 'Eixo-árvore horário', d: 'Liga a placa no sentido horário (visto da contraponta: anti-horário na tela).', ex: 'M03' },
      { c: 'M04', t: 'Eixo-árvore anti-horário', d: 'Liga a placa no sentido inverso.', ex: 'M04' },
      { c: 'M05', t: 'Desliga o eixo-árvore', d: 'Para a rotação da placa.', ex: 'M05' },
      { c: 'M08', t: 'Liga a refrigeração', d: 'Fluido de corte sobre a ferramenta.', ex: 'M08' },
      { c: 'M09', t: 'Desliga a refrigeração', d: '', ex: 'M09' },
      { c: 'M30', t: 'Fim de programa', d: 'Encerra e volta ao início do programa. M02 também encerra.', ex: 'M30' }
    ] }
  ];

  CNC.DIC = {};
  CNC.CODIGOS.forEach((g) => g.itens.forEach((i) => { CNC.DIC[i.c] = i; }));
  CNC.DIC.G18 = { c: 'G18', t: 'Plano ZX', d: 'Plano de trabalho do torno (padrão).' };
  CNC.DIC.G55 = CNC.DIC.G56 = CNC.DIC.G57 = CNC.DIC.G58 = CNC.DIC.G59 = { t: 'Zero-peça alternativo', d: 'Aceito; usa o mesmo zero do G54.' };
  CNC.DIC.M02 = { c: 'M02', t: 'Fim de programa', d: 'Encerra o programa.' };
})(window.CNC);
