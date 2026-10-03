import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { WorkerAvatar, AVATAR_COLORS } from './WorkerAvatar';
import { DEFAULT_WORKER_AVATAR, type WorkerAvatar as Avatar } from '@shared/crewGrowth';

export function WorkerPhotoAvatar() {
  const client=useQueryClient();
  const profile=useQuery<{preset:Avatar;imageUrl:string|null;draftId:string|null;photoEnabled:boolean}>({queryKey:['/api/crew/avatar']});
  const [photo,setPhoto]=useState<File|null>(null);
  const [style,setStyle]=useState('cartoon');
  const [consent,setConsent]=useState(false);
  const [draft,setDraft]=useState<Avatar>(DEFAULT_WORKER_AVATAR);
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{if(profile.data&&!dirty)setDraft(profile.data.preset);},[profile.data,dirty]);
  const generate=useMutation({mutationFn:async()=>{
    if(!photo)throw new Error('Choose a photo');
    const body=new FormData();body.set('photo',photo);body.set('style',style);body.set('consent',String(consent));
    const response=await fetch('/api/crew/avatar/generate',{method:'POST',body,credentials:'include'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Generation failed');return data;
  },onSuccess:()=>client.invalidateQueries({queryKey:['/api/crew/avatar']})});
  const approve=useMutation({mutationFn:()=>apiRequest('POST','/api/crew/avatar/approve',{draftId:profile.data?.draftId}),onSuccess:()=>client.invalidateQueries({queryKey:['/api/crew/avatar']})});
  const preset=useMutation({mutationFn:()=>apiRequest('PUT','/api/crew/avatar',draft),onSuccess:async()=>{await client.invalidateQueries({queryKey:['/api/crew/avatar']});setDirty(false);await client.invalidateQueries({queryKey:['/api/marketing-execution/bot-setup']});}});
  const busy=generate.isPending||approve.isPending||preset.isPending;
  return <details className="min-w-0 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-slate-100"><summary className="min-h-11 cursor-pointer content-center font-bold"><Camera className="mr-2 inline h-5 w-5 text-cyan-300"/>My public mover avatar</summary>
    <div className="mt-3 flex items-center gap-3">{profile.data?.imageUrl&&!dirty?<img className="h-20 w-20 rounded-full" src={profile.data.imageUrl} alt="Your published mover avatar"/>:<WorkerAvatar avatar={draft}/>}<p className="text-xs text-slate-400">{dirty?'Unsaved avatar preview':'Shows on your crew review and tip cards.'}</p></div>
    {profile.isLoading?<p role="status">Loading avatar…</p>:profile.isError?<p role="alert">Avatar could not load.</p>:<>
      <div className="my-3 grid grid-cols-4 gap-2">{(['mover','robot','explorer','spark'] as const).map(character=><button key={character} type="button" disabled={busy} aria-pressed={draft.character===character} aria-label={`Use ${character} avatar`} className={`min-h-16 rounded-xl border p-1 text-xs capitalize ${draft.character===character?'border-cyan-300':'border-slate-700'}`} onClick={()=>{setDirty(true);setDraft(current=>({...current,character}));}}><WorkerAvatar avatar={{...draft,character}} className="mx-auto h-10 w-10"/>{character}</button>)}</div>
      <div className="mb-3 flex flex-wrap gap-2" aria-label="Avatar color">{(Object.keys(AVATAR_COLORS) as Avatar['color'][]).map(color=><button key={color} type="button" disabled={busy} aria-label={`${color} avatar color`} aria-pressed={draft.color===color} style={{backgroundColor:AVATAR_COLORS[color]}} className="h-11 w-11 rounded-full border-2 border-slate-400 text-slate-950" onClick={()=>{setDirty(true);setDraft(current=>({...current,color}));}}>{draft.color===color?'✓':''}</button>)}</div>
      <div className="mb-3 grid grid-cols-2 gap-2">{(['none','cap','headphones','glasses'] as const).map(accessory=><button key={accessory} type="button" disabled={busy} aria-pressed={draft.accessory===accessory} className={`min-h-11 rounded-lg border text-xs capitalize ${draft.accessory===accessory?'border-cyan-300':'border-slate-700'}`} onClick={()=>{setDirty(true);setDraft(current=>({...current,accessory}));}}>{accessory}</button>)}</div>
      <Button disabled={busy||!dirty} className="mb-3 min-h-11 w-full" onClick={()=>preset.mutate()}>{preset.isPending?'Saving…':'Use this preset avatar'}</Button>
      {profile.data?.photoEnabled?<div className="space-y-3 border-t border-slate-700 pt-3">
        <label className="block text-sm">Your photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="mt-2 block w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:p-3" onChange={event=>setPhoto(event.target.files?.[0]||null)}/></label>
        <div className="grid grid-cols-3 gap-2" aria-label="Avatar art style">{['cartoon','comic','clay'].map(value=><button type="button" key={value} disabled={busy} aria-pressed={value===style} className={`min-h-11 rounded-xl border text-xs capitalize ${value===style?'border-cyan-300 bg-cyan-300/10':'border-slate-700'}`} onClick={()=>setStyle(value)}>{value}</button>)}</div>
        <label className="flex min-h-11 items-center gap-3 text-xs"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>This is my photo. Send it to the image service to create my avatar.</label>
        <Button className="min-h-11 w-full" disabled={busy||!photo||!consent||photo.size>5*1024*1024} onClick={()=>generate.mutate()}><Sparkles className="mr-2 h-4 w-4"/>{generate.isPending?'Creating preview…':'Make my cartoon'}</Button>
        <p className="text-xs text-slate-400">JPG, PNG or WebP · Up to 5 MB · 3 attempts per day. Preview first; publish only when you choose.</p>
      </div>:<p className="text-xs text-slate-400">Photo-to-cartoon needs the owner’s image-service connection. Preset avatars work now.</p>}
      {profile.data?.draftId&&<div className="mt-4 space-y-3"><img src={`/api/crew/avatar/preview/${profile.data.draftId}`} className="mx-auto h-40 w-40 rounded-2xl" alt="Private generated avatar preview"/><Button className="min-h-11 w-full" disabled={busy} onClick={()=>approve.mutate()}>{approve.isPending?'Publishing…':'Use this avatar publicly'}</Button></div>}
    </>}
    {(generate.error||approve.error||preset.error)&&<p role="alert" className="mt-2 text-sm text-rose-300">{(generate.error||approve.error||preset.error)?.message}</p>}
    {approve.isSuccess&&<p role="status" className="mt-2 text-sm text-emerald-300">Your avatar is published.</p>}
  </details>;
}
