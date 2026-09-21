import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';

const classroomMoments = [
  {
    boardLine: '为什么先配方？',
    boardNote: '把二次式改写成平方',
    caption: '先看为什么要配方：平方项能直接暴露最小值。',
    id: 'question',
    label: '我没跟上',
    studentNote: '这里为什么要配方？',
    teacherNote: '先把“为什么”讲清楚，再继续算。',
  },
  {
    boardLine: 'x² − 6x + 5 = (x − 3)² − 4',
    boardNote: '平方项 ≥ 0',
    caption: '有思路就先说关键一步；老师只核对依据，不抢着代做。',
    id: 'idea',
    label: '我有思路',
    studentNote: '我想把它写成顶点式。',
    teacherNote: '很好，先由你写出变形，我来检查等价性。',
  },
  {
    boardLine: '最小值为 −4',
    boardNote: '当 x = 3 时取到',
    caption: '最后补上取等条件，再换一道题独立验证。',
    id: 'next',
    label: '继续下一步',
    studentNote: '还需要说明什么时候取到。',
    teacherNote: '对，结论要和取等条件一起写完整。',
  },
] as const;

export function InteractiveClassroom() {
  const [activeMoment, setActiveMoment] = useState(0);
  const [paused, setPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const moment = classroomMoments[activeMoment];
  const isPlaying = !paused && !prefersReducedMotion;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPrefersReducedMotion(media.matches);
    syncPreference();
    media.addEventListener?.('change', syncPreference);
    return () => media.removeEventListener?.('change', syncPreference);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setActiveMoment((current) => (current + 1) % classroomMoments.length);
    }, 5_200);
    return () => window.clearInterval(timer);
  }, [activeMoment, isPlaying]);

  function moveClassroom(event: ReactPointerEvent<HTMLElement>) {
    if (prefersReducedMotion || event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty('--classroom-shift-x', `${x * 8}px`);
    event.currentTarget.style.setProperty('--classroom-shift-y', `${y * 5}px`);
  }

  function resetClassroom(event: ReactPointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty('--classroom-shift-x', '0px');
    event.currentTarget.style.setProperty('--classroom-shift-y', '0px');
  }

  return (
    <section
      className="interactive-classroom"
      data-moment={moment.id}
      aria-labelledby="interactive-classroom-title"
      onPointerMove={moveClassroom}
      onPointerLeave={resetClassroom}
    >
      <header className="classroom-header">
        <div>
          <span>CLASSROOM / 课堂演示</span>
          <h2 id="interactive-classroom-title">互动数学课堂</h2>
        </div>
        <button
          type="button"
          className="classroom-pause"
          aria-pressed={!isPlaying}
          disabled={prefersReducedMotion}
          onClick={() => setPaused((current) => !current)}
        >
          <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
          {prefersReducedMotion ? '已减少动效' : isPlaying ? '暂停课堂演示' : '继续课堂演示'}
        </button>
      </header>

      <div className="classroom-stage">
        <svg
          className="classroom-scene"
          viewBox="0 0 720 360"
          role="img"
          aria-label="老师在黑板讲解二次函数，学生在台下参与"
        >
          <defs>
            <linearGradient id="classroom-wall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f2eee2" />
              <stop offset="1" stopColor="#e2dccd" />
            </linearGradient>
            <pattern id="chalk-grid" width="26" height="26" patternUnits="userSpaceOnUse">
              <path d="M26 0H0V26" fill="none" stroke="rgba(238,244,224,.055)" strokeWidth="1" />
            </pattern>
          </defs>

          <rect width="720" height="360" fill="url(#classroom-wall)" />
          <path className="classroom-window-light" d="M0 0h126l94 360H82z" aria-hidden="true" />
          <path className="classroom-floor-line" d="M0 258H720" aria-hidden="true" />

          <g className="classroom-board-layer">
            <rect className="classroom-board-shadow" x="85" y="31" width="504" height="204" rx="3" />
            <rect className="classroom-board" x="76" y="23" width="504" height="204" rx="3" />
            <rect x="88" y="35" width="480" height="180" fill="url(#chalk-grid)" />
            <text className="chalk-kicker" x="103" y="61">例题 · 二次函数最值</text>
            <text className="chalk-problem" x="103" y="94">g(x) = x² − 6x + 5</text>
            <g className="chalk-step" key={moment.id}>
              <text className="chalk-line" x="103" y="139">{moment.boardLine}</text>
              <text className="chalk-note" x="103" y="176">{moment.boardNote}</text>
              <path className="chalk-underline" d="M103 188C180 184 275 191 393 186" />
            </g>
            <g className="board-corner-mark" aria-hidden="true">
              <path d="M535 58h17v17" />
              <text x="515" y="202">QISI / 01</text>
            </g>
          </g>

          <g className="teacher" data-pose={moment.id} key={`teacher-${moment.id}`}>
            <ellipse className="teacher-shadow" cx="627" cy="258" rx="45" ry="8" />
            <circle className="teacher-head" cx="630" cy="83" r="22" />
            <path className="teacher-hair" d="M609 82c2-25 39-31 45-4-10-9-26-12-45 4Z" />
            <path className="teacher-body" d="M605 109c14-10 38-10 51 0l12 91h-78Z" />
            <path className="teacher-shirt" d="M617 107h25l-3 44-10 10-10-10Z" />
            <path className="teacher-leg" d="M607 198l-2 57M649 198l5 57" />
            <path className="teacher-arm teacher-arm-rest" d="M607 120c-18 18-19 43-7 63" />
            <path
              className="teacher-arm teacher-arm-point"
              d={activeMoment === 0
                ? 'M651 120C624 126 586 130 523 137'
                : activeMoment === 1
                  ? 'M651 120C610 136 558 143 476 148'
                  : 'M651 120C619 142 572 163 493 176'}
            />
            <circle className="teacher-hand" cx={activeMoment === 0 ? 523 : activeMoment === 1 ? 476 : 493} cy={activeMoment === 0 ? 137 : activeMoment === 1 ? 148 : 176} r="4" />
          </g>

          <g className="student-row student-row-back">
            <Student x={218} y={251} active={moment.id === 'question'} />
            <Student x={353} y={247} active={moment.id === 'idea'} />
            <Student x={482} y={254} active={moment.id === 'next'} />
          </g>
          <g className="student-row student-row-front">
            <Student x={122} y={307} active={false} />
            <Student x={286} y={315} active={moment.id === 'idea'} />
            <Student x={461} y={309} active={false} />
          </g>
        </svg>

        <div
          className="classroom-thought"
          data-moment={moment.id}
          key={`thought-${moment.id}`}
          aria-hidden="true"
        >
          <span>学生想法</span>
          <strong>{moment.studentNote}</strong>
        </div>
        <div
          className="classroom-teacher-note"
          data-moment={moment.id}
          key={`teacher-note-${moment.id}`}
        >
          <span>老师回应</span>
          <p>{moment.teacherNote}</p>
        </div>
      </div>

      <div className="classroom-controls" role="group" aria-label="选择课堂回应">
        {classroomMoments.map((item, index) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={index === activeMoment}
            data-active={index === activeMoment}
            onClick={() => setActiveMoment(index)}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
      <p className="classroom-caption" role="status" aria-live="polite">
        {moment.caption}
      </p>
    </section>
  );
}

function Student({ active, x, y }: { active: boolean; x: number; y: number }) {
  return (
    <g className="classroom-student" data-active={active} transform={`translate(${x} ${y})`}>
      <ellipse className="student-shadow" cx="0" cy="34" rx="49" ry="7" />
      <path className="student-desk" d="M-48 2h96l-8 31h-80Z" />
      <circle className="student-head" cx="0" cy="-17" r="15" />
      <path className="student-hair" d="M-14-17c1-17 25-20 29-2-9-5-19-6-29 2Z" />
      <path className="student-body" d="M-22-1c12-12 32-12 44 0l8 24h-60Z" />
      <path className="student-notebook" d="M-21 8h42v14h-42Z" />
      <path className="student-pencil" d="m-16 16 27-5" />
      <path className="student-hand" d="M17 2C27-13 30-30 24-48" />
      <circle className="student-hand-tip" cx="24" cy="-49" r="3.5" />
    </g>
  );
}
