import {
  Color,
  BackSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SpotLight,
  Vector2,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Loadout } from '../cosmetics/catalog';
import { CATALOG, loadLoadout, saveLoadout, SLOT_LABELS } from '../cosmetics/catalog';
import type { Driver } from '../models/driver';
import { createDriver } from '../models/driver';
import type { PilotPose } from '../models/pilot/PilotRig';
import { isUnlocked, refreshAccount, saveAccountLoadout, sessionToken } from '../net/account';
import { disposeTree } from '../render/dispose';
import type { AppContext, GameScreen } from './types';
import { button } from './types';

/** Imagens de referencias/ para comparar lado a lado (só no servidor de desenvolvimento). */
const REFERENCES = [
  { file: 'referencia piloto.jpg', caption: 'Corpo inteiro — grafite e laranja' },
  { file: 'referencia piloto2.jpg', caption: 'Corpo inteiro — preto e vermelho' },
  { file: 'referencia piloto3.jpg', caption: 'Corpo inteiro — azul e branco' },
  { file: 'referencia piloto4.jpg', caption: 'Busto com balaclava' },
  { file: 'referencia piloto5.jpg', caption: 'Busto sem capacete' },
  { file: 'referencia piloto6.jpg', caption: 'Capacete' },
];

const TURNTABLE_HEIGHT = 0.14;
const POSES: { id: PilotPose; label: string }[] = [
  { id: 'seated', label: 'No kart' },
  { id: 'standing', label: 'Em pé' },
  { id: 'celebrate', label: 'Comemoração' },
];

/** Estúdio redondo: piso, parede em curva contínua (sem quina) e teto. */
function createRoom(): Group {
  const group = new Group();
  group.name = 'garage_room';

  const profile: Vector2[] = [new Vector2(0, 0), new Vector2(8.5, 0)];
  for (let i = 1; i <= 12; i++) {
    const angle = (i / 12) * (Math.PI / 2);
    profile.push(new Vector2(8.5 + Math.sin(angle) * 2.5, 2.5 - Math.cos(angle) * 2.5));
  }
  profile.push(new Vector2(11, 6), new Vector2(10.5, 6.6), new Vector2(0, 6.9));
  const shell = new Mesh(
    new LatheGeometry(profile, 72),
    new MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.55, metalness: 0.1, side: BackSide }),
  );
  shell.receiveShadow = true;

  // Luminárias de teto: painéis arredondados acesos (entram no bloom).
  const panels = new InstancedMesh(
    new RoundedBoxGeometry(4.6, 0.12, 0.7, 3, 0.05),
    new MeshStandardMaterial({ color: 0x111111, emissive: 0xfff3df, emissiveIntensity: 2.6 }),
    4,
  );
  const dummy = new Object3D();
  [-3.3, -1.1, 1.1, 3.3].forEach((z, i) => {
    dummy.position.set(0, 5.6, z);
    dummy.updateMatrix();
    panels.setMatrixAt(i, dummy.matrix);
  });

  group.add(shell, panels);
  return group;
}

/** Plataforma giratória: disco chanfrado com um anel de luz na borda. */
function createTurntable(): Group {
  const group = new Group();
  group.name = 'turntable';
  const radius = 2.5;
  const bevel = 0.04;
  const profile: Vector2[] = [
    new Vector2(0, TURNTABLE_HEIGHT),
    new Vector2(radius - bevel, TURNTABLE_HEIGHT),
  ];
  for (let i = 1; i <= 6; i++) {
    const angle = (i / 6) * (Math.PI / 2);
    profile.push(
      new Vector2(
        radius - bevel + Math.sin(angle) * bevel,
        TURNTABLE_HEIGHT - bevel + Math.cos(angle) * bevel,
      ),
    );
  }
  profile.push(new Vector2(radius, 0));
  const disc = new Mesh(
    new LatheGeometry(profile, 96),
    new MeshStandardMaterial({ color: 0x3b3f47, roughness: 0.3, metalness: 0.6 }),
  );
  disc.receiveShadow = true;

  const ring: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    ring.push(new Vector2(radius + 0.09 + Math.cos(angle) * 0.03, 0.035 + Math.sin(angle) * 0.03));
  }
  const glow = new Mesh(
    new LatheGeometry(ring, 96),
    new MeshStandardMaterial({ color: 0x101010, emissive: 0x6fd6ff, emissiveIntensity: 3.2 }),
  );
  group.add(disc, glow);
  return group;
}

function createLights(scene: Scene): void {
  scene.add(new HemisphereLight(0xdfe8ff, 0x2b2620, 0.35));
  const spot = (x: number, y: number, z: number, intensity: number, shadow: boolean): void => {
    const light = new SpotLight(0xfff1dc, intensity, 30, 0.6, 0.6, 1.4);
    light.position.set(x, y, z);
    light.target.position.set(0, 0.6, 0);
    if (shadow) {
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 5;
    }
    scene.add(light, light.target);
  };
  // Intensidades contidas: o branco do macacão não pode passar de 1 e entrar no bloom.
  spot(3.5, 6, 4.5, 95, true); // principal
  spot(-5, 4.2, 2.5, 30, false); // preenchimento
  spot(0, 5, -6, 55, false); // contraluz
}

/**
 * Garagem: plataforma giratória iluminada com kart + piloto + capacete, troca
 * de cosméticos com pré-visualização antes de aplicar e, em desenvolvimento,
 * as imagens de referência ao lado para comparar.
 */
export function createGarageScreen(context: AppContext): GameScreen {
  const { renderer, canvas, models, ui } = context;
  const scene = new Scene();
  scene.background = new Color(0x15171b);
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(3.4, 1.7, 4.2);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 0.75, 0);
  controls.minDistance = 1.2;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;

  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.6;

  const turntable = createTurntable();
  const stage = new Group(); // tudo o que gira junto com a plataforma
  stage.position.y = TURNTABLE_HEIGHT;
  turntable.add(stage);
  scene.add(createRoom(), turntable);
  createLights(scene);

  let disposed = false;
  let driver: Driver | undefined;
  let applied = loadLoadout();
  let preview: Loadout = { ...applied };
  let pose: PilotPose = 'seated';
  let spinning = true;
  let steer = 0;
  let requestId = 0;
  let focusHelmet = false;
  const helmetPosition = new Vector3();

  // --- painel de cosméticos ------------------------------------------------
  const panel = document.createElement('section');
  panel.className = 'painel';
  panel.setAttribute('aria-label', 'Garagem');
  const chips = new Map<keyof Loadout, Map<string, HTMLButtonElement>>();

  const applyButton = document.createElement('button');
  const undoButton = document.createElement('button');
  const refreshButtons = (): void => {
    for (const [slot, buttons] of chips) {
      for (const [id, element] of buttons) {
        element.setAttribute('aria-pressed', String(preview[slot] === id));
        // Item de catálogo que não está no inventário não pode ser equipado.
        const locked = !isUnlocked(slot, id);
        element.disabled = locked;
        element.classList.toggle('bloqueado', locked);
        element.title = locked ? 'Bloqueado: este item ainda não está no seu inventário.' : '';
      }
    }
    const changed = (Object.keys(preview) as (keyof Loadout)[]).some(
      (slot) => preview[slot] !== applied[slot],
    );
    applyButton.disabled = undoButton.disabled = !changed;
  };
  const showPreview = (): void => {
    refreshButtons();
    const id = ++requestId;
    void driver?.setLoadout({ ...preview }).then(() => {
      if (id === requestId && !disposed) setPose(pose);
    });
  };

  for (const slot of Object.keys(CATALOG) as (keyof Loadout)[]) {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = SLOT_LABELS[slot];
    const row = document.createElement('div');
    row.className = 'botoes';
    group.append(legend, row);
    const buttons = new Map<string, HTMLButtonElement>();
    for (const item of CATALOG[slot]) {
      buttons.set(
        item.id,
        button(row, item.name, () => {
          preview = { ...preview, [slot]: item.id };
          showPreview();
        }),
      );
    }
    chips.set(slot, buttons);
    panel.append(group);
  }

  const actions = document.createElement('div');
  actions.className = 'botoes acoes';
  applyButton.type = undoButton.type = 'button';
  applyButton.className = 'primario';
  applyButton.textContent = 'Aplicar';
  undoButton.textContent = 'Desfazer';
  applyButton.addEventListener('click', () => {
    applied = { ...preview };
    saveLoadout(applied);
    refreshButtons();
    context.setStatus('Garagem · visual aplicado');
    if (sessionToken()) {
      saveAccountLoadout(applied)
        .then(() => context.setStatus('Garagem · visual salvo na sua conta'))
        .catch((erro: unknown) => {
          context.setStatus(erro instanceof Error ? erro.message : 'Não consegui salvar.', true);
        });
    }
  });
  undoButton.addEventListener('click', () => {
    preview = { ...applied };
    showPreview();
  });
  actions.append(applyButton, undoButton);
  panel.append(actions);

  // Com conta, o inventário e o loadout do servidor mandam.
  void refreshAccount()
    .then((me) => {
      if (disposed || !me) return;
      applied = loadLoadout();
      preview = { ...applied };
      showPreview();
    })
    .catch(() => {
      // Servidor fora do ar: a garagem segue com o que está neste navegador.
    });

  // --- pose e animações ----------------------------------------------------
  const view = document.createElement('section');
  view.className = 'painel-visao';
  const poseRow = document.createElement('div');
  poseRow.className = 'botoes';
  const poseButtons = new Map<PilotPose, HTMLButtonElement>();
  function setPose(next: PilotPose): void {
    pose = next;
    for (const [id, element] of poseButtons)
      element.setAttribute('aria-pressed', String(id === next));
    if (!driver) return;
    const pilot = driver.pilot;
    if (next === 'seated') {
      driver.kart.add(pilot.root);
      pilot.root.position.set(0, 0, 0);
      controls.target.set(0, 0.75, 0);
    } else {
      // Em pé ao lado do kart, na pose das imagens de referência.
      stage.add(pilot.root);
      pilot.root.position.set(1.35, 0, 0.1);
      controls.target.set(0.6, 0.95, 0);
    }
    pilot.setPose(next);
  }
  for (const item of POSES)
    poseButtons.set(
      item.id,
      button(poseRow, item.label, () => setPose(item.id)),
    );

  const spinLabel = document.createElement('label');
  const spinInput = document.createElement('input');
  spinInput.type = 'checkbox';
  spinInput.checked = spinning;
  spinInput.addEventListener('change', () => {
    spinning = spinInput.checked;
  });
  spinLabel.append(spinInput, ' Girar plataforma');

  const steerLabel = document.createElement('label');
  const steerInput = document.createElement('input');
  steerInput.type = 'range';
  steerInput.min = '-100';
  steerInput.max = '100';
  steerInput.value = '0';
  steerInput.addEventListener('input', () => {
    steer = (Number(steerInput.value) / 100) * 0.5;
  });
  steerLabel.append('Volante ', steerInput);
  // Foco da câmera: o conjunto todo ou o capacete de perto (para comparar com a referência).
  const focusRow = document.createElement('div');
  focusRow.className = 'botoes';
  const focusButtons = [
    button(focusRow, 'Ver conjunto', () => setFocus(false)),
    button(focusRow, 'Ver capacete', () => setFocus(true)),
  ] as const;
  function setFocus(onHelmet: boolean): void {
    focusHelmet = onHelmet;
    focusButtons[0].setAttribute('aria-pressed', String(!onHelmet));
    focusButtons[1].setAttribute('aria-pressed', String(onHelmet));
    controls.minDistance = onHelmet ? 0.4 : 1.2;
    if (onHelmet) {
      camera.position.sub(controls.target).setLength(0.75);
      camera.position.y = Math.max(camera.position.y, 0.05);
    } else {
      camera.position.sub(controls.target).setLength(5.6);
      setPose(pose);
    }
    camera.position.add(controls.target);
  }
  setFocus(false);
  view.append(poseRow, focusRow, spinLabel, steerLabel);

  ui.append(panel, view);

  // --- referências (só em desenvolvimento; nunca entram no build) -----------
  if (import.meta.env.DEV) {
    const figure = document.createElement('figure');
    figure.className = 'referencia';
    const image = document.createElement('img');
    const caption = document.createElement('figcaption');
    const nav = document.createElement('div');
    nav.className = 'botoes';
    let index = 0;
    const show = (next: number): void => {
      index = (next + REFERENCES.length) % REFERENCES.length;
      const reference = REFERENCES[index];
      if (!reference) return;
      image.src = `/referencias/${encodeURIComponent(reference.file)}`;
      image.alt = `Imagem de referência: ${reference.caption}`;
      caption.textContent = `Referência ${index + 1}/${REFERENCES.length} · ${reference.caption}`;
    };
    button(nav, '‹ Anterior', () => show(index - 1));
    button(nav, 'Próxima ›', () => show(index + 1));
    figure.append(image, caption, nav);
    ui.append(figure);
    show(2);
  }

  refreshButtons();
  context.setStatus('Garagem · carregando…');
  createDriver(models, preview)
    .then((created) => {
      if (disposed) return;
      driver = created;
      // Centraliza o kart na plataforma (o pivô dele fica no eixo traseiro).
      created.kart.position.set(0, 0, -0.6);
      stage.add(created.kart);
      setPose(pose);
      context.setStatus('Garagem · escolha os itens e clique em Aplicar');
    })
    .catch((erro: unknown) => {
      console.error(erro);
      context.setStatus('Não foi possível carregar o kart. Rode "pnpm assets" e recarregue.', true);
    });

  return {
    scene,
    camera,
    update(delta) {
      if (spinning) turntable.rotation.y += delta * 0.35;
      driver?.update(delta, 0, steer);
      if (focusHelmet && driver) {
        // A câmera acompanha a cabeça, que gira com a plataforma e mexe com o piloto.
        const helmet = driver.pilot.root.getObjectByName('helmet');
        if (helmet) {
          helmet.getWorldPosition(helmetPosition);
          camera.position.add(helmetPosition).sub(controls.target);
          controls.target.copy(helmetPosition);
        }
      }
      controls.update(delta);
    },
    dispose() {
      disposed = true;
      controls.dispose();
      ui.replaceChildren();
      disposeTree(scene);
      environment.dispose();
    },
  };
}
