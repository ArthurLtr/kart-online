import { Color, Group, PerspectiveCamera, PMREMGenerator, Scene, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Loadout } from '../cosmetics/catalog';
import { CATALOG, loadLoadout, saveLoadout, SLOT_LABELS } from '../cosmetics/catalog';
import type { Driver } from '../models/driver';
import { createDriver } from '../models/driver';
import type { PilotPose } from '../models/pilot/PilotRig';
import { isUnlocked, refreshAccount, saveAccountLoadout, sessionToken } from '../net/account';
import { disposeTree } from '../render/dispose';
import {
  createRoom,
  createStudioLights,
  createTurntable,
  TURNTABLE_HEIGHT,
} from '../render/studio';
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

const POSES: { id: PilotPose; label: string }[] = [
  { id: 'seated', label: 'No kart' },
  { id: 'standing', label: 'Em pé' },
  { id: 'celebrate', label: 'Comemoração' },
];

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
  createStudioLights(scene);

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
