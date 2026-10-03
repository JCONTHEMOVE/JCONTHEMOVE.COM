import React from 'react';
import { type WorkerAvatar as Avatar, DEFAULT_WORKER_AVATAR } from '@shared/crewGrowth';

export const AVATAR_COLORS={cyan:'#22d3ee',violet:'#a78bfa',amber:'#fbbf24',emerald:'#34d399',rose:'#fb7185'};

/** Preset vector parts keep avatars lightweight, accessible and free of uploaded content. */
export function WorkerAvatar({avatar=DEFAULT_WORKER_AVATAR,label='Worker avatar',className='h-16 w-16'}:{avatar?:Avatar;label?:string;className?:string}) {
  const color=AVATAR_COLORS[avatar.color]||AVATAR_COLORS.cyan;
  return <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" role="img" aria-label={label} className={className}>
    <circle cx="50" cy="50" r="47" fill="#0f172a" stroke={color} strokeWidth="3"/>
    <path d="M20 91Q21 67 50 67Q79 67 80 91" fill={color}/>
    {avatar.character==='robot'?<rect x="26" y="25" width="48" height="44" rx="12" fill={color}/>:avatar.character==='spark'?<path d="M50 18L60 32L78 37L70 54L72 72L50 67L28 72L30 54L22 37L40 32Z" fill={color}/>:<ellipse cx="50" cy="47" rx="24" ry="26" fill={avatar.character==='explorer'?'#cbd5e1':'#fde68a'}/>}
    {avatar.character==='robot'&&<path d="M50 25V15M44 15H56" stroke={color} strokeWidth="4" strokeLinecap="round"/>}
    <circle cx="41" cy="46" r="3" fill="#0f172a"/><circle cx="59" cy="46" r="3" fill="#0f172a"/>
    <path d="M41 57Q50 64 59 57" fill="none" stroke="#0f172a" strokeWidth="3" strokeLinecap="round"/>
    {avatar.accessory==='cap'&&<path d="M24 33Q27 12 50 16Q71 16 75 33H22M50 32H83" fill={color} stroke="#0f172a" strokeWidth="3" strokeLinejoin="round"/>}
    {avatar.accessory==='headphones'&&<g fill="#334155" stroke="#e2e8f0" strokeWidth="3"><path d="M24 47V39A26 26 0 0 1 76 39V47" fill="none"/><rect x="20" y="40" width="9" height="17" rx="4"/><rect x="71" y="40" width="9" height="17" rx="4"/></g>}
    {avatar.accessory==='glasses'&&<g fill="none" stroke="#334155" strokeWidth="3"><rect x="32" y="40" width="16" height="12" rx="4"/><rect x="52" y="40" width="16" height="12" rx="4"/><path d="M48 45H52"/></g>}
    <path d="M43 80H57M50 73V87" stroke="#0f172a" strokeWidth="4" strokeLinecap="round"/>
  </svg>;
}
