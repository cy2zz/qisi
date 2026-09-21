import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as THREE from 'three';

export type OneToOneMomentId = 'idea' | 'question' | 'review';

interface OneToOneClassroom3DProps {
  focused: boolean;
  momentId: OneToOneMomentId;
  paused: boolean;
  reducedMotion: boolean;
  username: string;
}

interface ClassroomRig {
  armPivot: THREE.Group;
  boardCanvas: HTMLCanvasElement;
  boardTexture: THREE.CanvasTexture;
  camera: THREE.PerspectiveCamera;
  deskLight: THREE.PointLight;
  dust: THREE.Points;
  dustPositions: Float32Array;
  head: THREE.Mesh;
  paperCanvas: HTMLCanvasElement;
  paperTexture: THREE.CanvasTexture;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  teacher: THREE.Group;
}

const boardCopy: Record<OneToOneMomentId, { accent: string; detail: string; title: string }> = {
  question: {
    accent: '老师只讲清这一处',
    detail: '把二次式改写成平方，才能直接观察最小值',
    title: '当前卡点：为什么先配方？',
  },
  idea: {
    accent: '等待你写出关键一步',
    detail: 'x² − 6x + 5 = (x − 3)² − 4',
    title: '学生路线：尝试写成顶点式',
  },
  review: {
    accent: '老师正在核对你的这一步',
    detail: '最小值 −4，还需要说明 x = 3 时取到',
    title: '本轮核对：结论和取等条件',
  },
};

export function OneToOneClassroom3D({
  focused,
  momentId,
  paused,
  reducedMotion,
  username,
}: OneToOneClassroom3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const rigRef = useRef<ClassroomRig | null>(null);
  const [ready, setReady] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window.WebGLRenderingContext === 'undefined') {
      setWebglAvailable(false);
      setReady(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: false,
        antialias: true,
        canvas,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglAvailable(false);
      setReady(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfd8c8');
    scene.fog = new THREE.Fog('#dfd8c8', 9, 18);

    const camera = new THREE.PerspectiveCamera(44, 2, 0.1, 40);
    camera.position.set(0, 2.15, 7.1);

    scene.add(new THREE.HemisphereLight('#fff8e9', '#70634e', 2.4));
    const keyLight = new THREE.DirectionalLight('#fff2d6', 2.8);
    keyLight.position.set(-4, 7, 6);
    scene.add(keyLight);
    const deskLight = new THREE.PointLight('#ffd68d', 1.1, 8, 1.6);
    deskLight.position.set(-1.6, 1.8, 3.8);
    scene.add(deskLight);

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(14, 7, 0.22),
      new THREE.MeshStandardMaterial({ color: '#e8e1d2', roughness: 0.96 }),
    );
    wall.position.set(0, 2, -4.2);
    scene.add(wall);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 14),
      new THREE.MeshStandardMaterial({ color: '#bba98a', roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.05, 1);
    scene.add(floor);

    const floorLines = new THREE.GridHelper(14, 18, '#8b7a5f', '#ad9b7d');
    floorLines.position.y = -1.035;
    floorLines.material.opacity = 0.24;
    floorLines.material.transparent = true;
    scene.add(floorLines);

    const boardFrame = new THREE.Mesh(
      new THREE.BoxGeometry(6.6, 3, 0.22),
      new THREE.MeshStandardMaterial({ color: '#6f4c28', roughness: 0.78 }),
    );
    boardFrame.position.set(-0.65, 1.55, -3.92);
    scene.add(boardFrame);

    const boardCanvas = document.createElement('canvas');
    boardCanvas.width = 1024;
    boardCanvas.height = 512;
    const boardTexture = new THREE.CanvasTexture(boardCanvas);
    boardTexture.colorSpace = THREE.SRGBColorSpace;
    boardTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(6.28, 2.68),
      new THREE.MeshBasicMaterial({ map: boardTexture }),
    );
    board.position.set(-0.65, 1.55, -3.78);
    scene.add(board);

    const teacher = createTeacher();
    teacher.position.set(2.7, -1.02, -2.88);
    scene.add(teacher);
    const armPivot = teacher.getObjectByName('pointing-arm') as THREE.Group;
    const head = teacher.getObjectByName('teacher-head') as THREE.Mesh;

    const desk = new THREE.Group();
    const deskTop = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.22, 1.75),
      new THREE.MeshStandardMaterial({ color: '#8b572e', roughness: 0.7 }),
    );
    deskTop.position.y = 0;
    desk.add(deskTop);
    for (const x of [-2.15, 2.15]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 1.15, 0.16),
        new THREE.MeshStandardMaterial({ color: '#4a3828', roughness: 0.86 }),
      );
      leg.position.set(x, -0.62, 0.35);
      desk.add(leg);
    }
    desk.position.set(-0.25, -0.48, 2.7);
    scene.add(desk);

    const paperCanvas = document.createElement('canvas');
    paperCanvas.width = 768;
    paperCanvas.height = 384;
    const paperTexture = new THREE.CanvasTexture(paperCanvas);
    paperTexture.colorSpace = THREE.SRGBColorSpace;
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 1.4),
      new THREE.MeshStandardMaterial({ map: paperTexture, roughness: 0.88 }),
    );
    paper.rotation.x = -Math.PI / 2;
    paper.rotation.z = -0.035;
    paper.position.set(-0.55, -0.34, 2.28);
    scene.add(paper);

    const pencil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.35, 8),
      new THREE.MeshStandardMaterial({ color: '#ff5b3d', roughness: 0.6 }),
    );
    pencil.rotation.z = Math.PI / 2.35;
    pencil.rotation.x = Math.PI / 2;
    pencil.position.set(1.42, -0.27, 2.16);
    scene.add(pencil);

    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(72 * 3);
    for (let index = 0; index < dustPositions.length; index += 3) {
      dustPositions[index] = -3.4 + Math.random() * 5.6;
      dustPositions[index + 1] = 0.25 + Math.random() * 2.6;
      dustPositions[index + 2] = -3.35 + Math.random() * 0.34;
    }
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: '#f5edcf',
        opacity: 0.34,
        size: 0.025,
        transparent: true,
      }),
    );
    scene.add(dust);

    const rig: ClassroomRig = {
      armPivot,
      boardCanvas,
      boardTexture,
      camera,
      deskLight,
      dust,
      dustPositions,
      head,
      paperCanvas,
      paperTexture,
      renderer,
      scene,
      teacher,
    };
    rigRef.current = rig;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderClassroom(rig, momentId, focused, pointerRef.current, false, reducedMotion);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    setReady(true);

    const contextLost = (event: Event) => {
      event.preventDefault();
      setWebglAvailable(false);
    };
    canvas.addEventListener('webglcontextlost', contextLost);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      rigRef.current = null;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      boardTexture.dispose();
      paperTexture.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    drawBoard(rig.boardCanvas, momentId, username);
    rig.boardTexture.needsUpdate = true;
    drawPaper(rig.paperCanvas, username);
    rig.paperTexture.needsUpdate = true;
    renderClassroom(rig, momentId, focused, pointerRef.current, false, reducedMotion);
  }, [focused, momentId, reducedMotion, username, ready]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    if (paused || reducedMotion) {
      renderClassroom(rig, momentId, focused, pointerRef.current, false, reducedMotion);
      return;
    }

    let animationFrame = 0;
    const tick = (time: number) => {
      if (!document.hidden) {
        renderClassroom(rig, momentId, focused, pointerRef.current, true, reducedMotion, time);
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [focused, momentId, paused, ready, reducedMotion]);

  function updatePointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (reducedMotion || event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
      y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
    };
  }

  function resetPointer() {
    pointerRef.current = { x: 0, y: 0 };
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className="classroom-3d-canvas"
        data-ready={ready && webglAvailable}
        aria-hidden="true"
        onPointerMove={updatePointer}
        onPointerLeave={resetPointer}
      />
      {!webglAvailable ? (
        <div className="classroom-3d-fallback" data-moment={momentId} aria-hidden="true">
          <div className="fallback-board">
            <span>MISSION / 一对一辅导</span>
            <strong>{boardCopy[momentId].title}</strong>
            <small>{boardCopy[momentId].detail}</small>
          </div>
          <div className="fallback-teacher"><span /></div>
          <div className="fallback-desk">辅导对象：{username.trim() || '等待进入'}</div>
        </div>
      ) : null}
    </>
  );
}

function createTeacher() {
  const teacher = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#202b35', roughness: 0.76 });
  const shirt = new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 0.86 });
  const skin = new THREE.MeshStandardMaterial({ color: '#d39a72', roughness: 0.8 });
  const hair = new THREE.MeshStandardMaterial({ color: '#17202a', roughness: 0.92 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 1.35, 12), dark);
  body.position.y = 0.75;
  teacher.add(body);

  const shirtPanel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.66, 0.08), shirt);
  shirtPanel.position.set(0, 0.92, 0.38);
  teacher.add(shirtPanel);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 20, 16), skin);
  head.name = 'teacher-head';
  head.position.y = 1.75;
  teacher.add(head);

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 12), hair);
  hairCap.scale.set(1.04, 0.52, 1.02);
  hairCap.position.set(0, 1.91, -0.02);
  teacher.add(hairCap);

  for (const x of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.92, 8), dark);
    leg.position.set(x, -0.36, 0);
    teacher.add(leg);
  }

  const restingArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.92, 8), skin);
  restingArm.rotation.z = 0.14;
  restingArm.position.set(0.49, 0.65, 0);
  teacher.add(restingArm);

  const armPivot = new THREE.Group();
  armPivot.name = 'pointing-arm';
  armPivot.position.set(-0.38, 1.26, 0);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.92, 8), skin);
  arm.position.y = -0.43;
  armPivot.add(arm);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), skin);
  hand.position.y = -0.9;
  armPivot.add(hand);
  teacher.add(armPivot);

  return teacher;
}

function drawBoard(canvas: HTMLCanvasElement, momentId: OneToOneMomentId, username: string) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const copy = boardCopy[momentId];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#173c34';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = 'rgba(238,244,224,.055)';
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.fillStyle = 'rgba(238,244,224,.65)';
  context.font = '700 22px ui-monospace, Menlo, monospace';
  context.fillText('MISSION 01 / 一对一辅导', 54, 58);
  context.fillStyle = '#f5f1df';
  context.font = 'italic 42px Georgia, serif';
  context.fillText('g(x) = x² − 6x + 5', 54, 125);
  context.fillStyle = '#ffffff';
  context.font = '700 31px "Microsoft YaHei", "PingFang SC", sans-serif';
  context.fillText(copy.title, 54, 205);
  context.fillStyle = '#f2c96d';
  context.font = '24px "Microsoft YaHei", "PingFang SC", sans-serif';
  context.fillText(copy.detail, 54, 260);
  context.strokeStyle = '#ff8269';
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(54, 282);
  context.quadraticCurveTo(280, 273, 610, 282);
  context.stroke();
  context.fillStyle = 'rgba(238,244,224,.5)';
  context.font = '18px "Microsoft YaHei", "PingFang SC", sans-serif';
  context.fillText(copy.accent, 54, 342);
  context.fillStyle = 'rgba(238,244,224,.38)';
  context.font = '17px ui-monospace, Menlo, monospace';
  context.fillText(`辅导对象：${username.trim() || '等待进入'}`, 695, 454);
}

function drawPaper(canvas: HTMLCanvasElement, username: string) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#fffdf7';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(40,100,220,.12)';
  context.lineWidth = 2;
  for (let y = 68; y < canvas.height; y += 52) {
    context.beginPath();
    context.moveTo(34, y);
    context.lineTo(canvas.width - 28, y);
    context.stroke();
  }
  context.strokeStyle = 'rgba(255,91,61,.35)';
  context.beginPath();
  context.moveTo(82, 0);
  context.lineTo(82, canvas.height);
  context.stroke();
  context.fillStyle = '#2864dc';
  context.font = '700 22px ui-monospace, Menlo, monospace';
  context.fillText('PLAYER / 学生席', 110, 48);
  context.fillStyle = '#18212b';
  context.font = '700 36px "Microsoft YaHei", "PingFang SC", sans-serif';
  context.fillText(username.trim() || '等待学生进入', 110, 118);
  context.fillStyle = '#66707a';
  context.font = '24px "Microsoft YaHei", "PingFang SC", sans-serif';
  context.fillText('先写自己的关键一步', 110, 184);
}

function renderClassroom(
  rig: ClassroomRig,
  momentId: OneToOneMomentId,
  focused: boolean,
  pointer: { x: number; y: number },
  animated: boolean,
  reducedMotion: boolean,
  time = 0,
) {
  const targets: Record<OneToOneMomentId, number> = {
    question: -1.08,
    idea: -0.34,
    review: -0.82,
  };
  const easing = animated ? 0.075 : 1;
  rig.armPivot.rotation.z = THREE.MathUtils.lerp(
    rig.armPivot.rotation.z,
    targets[momentId],
    easing,
  );
  rig.head.rotation.y = THREE.MathUtils.lerp(
    rig.head.rotation.y,
    focused || momentId === 'idea' ? 0.26 : -0.18,
    easing,
  );

  const idle = animated && !reducedMotion ? Math.sin(time * 0.0018) * 0.018 : 0;
  rig.teacher.position.y = -1.02 + idle;
  rig.deskLight.intensity = THREE.MathUtils.lerp(
    rig.deskLight.intensity,
    focused ? 2.35 : 1.15,
    easing,
  );

  const targetX = reducedMotion ? 0 : pointer.x * 0.18;
  const targetY = 2.15 - (reducedMotion ? 0 : pointer.y * 0.08);
  const targetZ = focused ? 6.55 : 7.1;
  rig.camera.position.x = THREE.MathUtils.lerp(rig.camera.position.x, targetX, easing);
  rig.camera.position.y = THREE.MathUtils.lerp(rig.camera.position.y, targetY, easing);
  rig.camera.position.z = THREE.MathUtils.lerp(rig.camera.position.z, targetZ, easing);
  rig.camera.lookAt(0, 0.72, -1.6);

  if (animated && !reducedMotion) {
    for (let index = 1; index < rig.dustPositions.length; index += 3) {
      rig.dustPositions[index] -= 0.0025;
      if (rig.dustPositions[index] < 0.1) rig.dustPositions[index] = 2.8;
    }
    const position = rig.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.needsUpdate = true;
  }

  rig.renderer.render(rig.scene, rig.camera);
}
