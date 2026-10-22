"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import type { TrackMusic } from "@/lib/api";
import styles from "./tracks.module.css";

type Props = {
  musics: TrackMusic[];
  /** 並べ替えたあとの順番を受け取る */
  onReorder: (next: TrackMusic[]) => void;
  /** 「外す」を押したとき（確認はここではしない） */
  onRemove: (music: TrackMusic) => void;
};

function SortableItem({ music, index, onRemove }: { music: TrackMusic; index: number; onRemove: Props["onRemove"] }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: music.trackMusicId,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${styles.musicItem} ${isDragging ? styles.musicItemDragging : ""}`}
    >
      {/* つまみ部分だけでドラッグする（スマホでリストをスクロールできるように） */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        className={styles.dragHandle}
        aria-label={`${music.name} の順番を変える`}
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span className={styles.musicIndex}>{index + 1}</span>
      <span className={styles.musicName}>{music.name}</span>
      <span className={styles.musicActions}>
        <Link href={`/editor?trackMusicId=${music.trackMusicId}`} className={styles.primarySmall}>
          編集
        </Link>
        <button type="button" className={styles.secondary} onClick={() => onRemove(music)}>
          外す
        </button>
      </span>
    </li>
  );
}

export default function SortableMusicList({ musics, onReorder, onRemove }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = musics.findIndex((m) => m.trackMusicId === active.id);
    const to = musics.findIndex((m) => m.trackMusicId === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(musics, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={musics.map((m) => m.trackMusicId)} strategy={verticalListSortingStrategy}>
        <ol className={styles.musicList}>
          {musics.map((m, i) => (
            <SortableItem key={m.trackMusicId} music={m} index={i} onRemove={onRemove} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
