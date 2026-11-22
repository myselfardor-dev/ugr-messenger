(()=>{ 
const style=document.createElement('style');style.textContent=`
.bubble.selected{outline:2px solid #b18cff!important;background:linear-gradient(135deg,#33264f,#24203b)!important;box-shadow:0 0 0 4px #a78bfa22,0 8px 24px #0005!important}
.chat-selection-bar{position:relative;z-index:8;display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 12px;background:linear-gradient(135deg,#211b31,#171b28);border:1px solid #554475;border-radius:14px;margin:0 auto 8px;max-width:850px;width:100%;box-shadow:0 8px 25px #0005}
.chat-selection-bar .selection-count{font-weight:800;color:#e5d7ff;margin-right:auto}
.chat-selection-bar button{background:#302744;border:1px solid #51416d;border-radius:10px;padding:9px 11px;font-size:13px}
.chat-selection-bar button:disabled{opacity:.35}
`;document.head.append(style);
window.selectMessage=function(id){selectedMessageIds.add(id);document.querySelector('[data-id="'+id+'"]')?.classList.add('selected');showSelectionBar()};
window.toggleMessageSelection=function(id){if(selectedMessageIds.has(id)){selectedMessageIds.delete(id);document.querySelector('[data-id="'+id+'"]')?.classList.remove('selected')}else{selectMessage(id)}showSelectionBar()};
window.clearSelection=function(){selectedMessageIds.forEach(id=>document.querySelector('[data-id="'+id+'"]')?.classList.remove('selected'));selectedMessageIds.clear();$('chatSelectionBar')?.remove()};
window.showSelectionBar=function(){
 let bar=$('chatSelectionBar');if(!bar){bar=document.createElement('div');bar.id='chatSelectionBar';bar.className='chat-selection-bar';$('composer-wrap')?.before(bar)}
 bar.innerHTML='';if(!selectedMessageIds.size){bar.remove();return}
 const count=document.createElement('span');count.className='selection-count';count.textContent='Выбрано: '+selectedMessageIds.size;bar.append(count);
 const add=(label,fn,disabled=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=disabled;b.onclick=fn;bar.append(b)};
 add('✕',clearSelection);
 add('📋 Копировать',async()=>{const texts=[...selectedMessageIds].map(id=>document.querySelector('[data-id="'+id+'"] .msg-content')?.innerText||'').join('\\n');try{await navigator.clipboard.writeText(texts);toast('Сообщение скопировано')}catch{toast('Не удалось скопировать')}clearSelection()});
 const ids=[...selectedMessageIds],only=ids.length===1?document.querySelector('[data-id="'+ids[0]+'"]'):null;
 const canEdit=!!only?.classList.contains('mine')&&!only.querySelector('.voice-card');
 add('✏️ Изменить',()=>{const id=ids[0],el=document.querySelector('[data-id="'+id+'"]'),old=el?.querySelector('.msg-content')?.innerText||'';const next=prompt('Изменить сообщение:',old);if(next===null)return;if(!next.trim()){toast('Сообщение не может быть пустым');return}editSelectedMessage(id,next.trim())},!canEdit);
 add('🗑 Удалить',async()=>{const own=ids.filter(id=>document.querySelector('[data-id="'+id+'"]')?.classList.contains('mine'));if(!own.length){toast('Можно удалять только свои сообщения');return}if(!confirm('Удалить выбранные сообщения?'))return;for(const id of own){const {error}=await sb.from('messages').delete().eq('id',id).eq('sender_id',currentUser.id);if(error){toast('Ошибка удаления: '+error.message);return}document.querySelector('[data-id="'+id+'"]')?.remove()}toast('Удалено: '+own.length);clearSelection()},!ids.some(id=>document.querySelector('[data-id="'+id+'"]')?.classList.contains('mine')));
};
window.editSelectedMessage=async function(id,value){const {data,error}=await sb.from('messages').update({body:value}).eq('id',id).eq('sender_id',currentUser.id).select('id,conversation_id,sender_id,body,created_at,delivered_at,read_at,message_type,media_url,reactions,reply_to_id,pinned_at').single();if(error){toast('Не удалось изменить: '+error.message);return}refreshMessage(data);toast('Сообщение изменено');clearSelection()};
window.showMessageActions=function(m){if(m.sender_id===currentUser.id||selectedMessageIds.size){if(!selectedMessageIds.has(m.id))selectMessage(m.id);else showSelectionBar();return}const old=document.querySelector('.message-action-menu');old?.remove();const menu=document.createElement('div');menu.className='message-action-menu';menu.style.cssText='position:fixed;z-index:100;left:50%;top:50%;transform:translate(-50%,-50%);background:#17121f;border:1px solid #7952a0;border-radius:14px;padding:10px;display:flex;flex-wrap:wrap;gap:7px;box-shadow:0 12px 40px #000b;max-width:90vw';[['↩ Ответить',()=>setReply(m)],['📋 Копировать',()=>navigator.clipboard?.writeText(m.body||'').then(()=>toast('Скопировано'))],['✕ Закрыть',()=>{}]].forEach(([label,fn])=>{const b=document.createElement('button');b.textContent=label;b.onclick=()=>{menu.remove();fn()};menu.append(b)});document.body.append(menu);const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('pointerdown',close)}};setTimeout(()=>document.addEventListener('pointerdown',close),0)};
})();