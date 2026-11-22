
const SUPABASE_URL='https://wpdltxncbzcuwmidtzys.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_PNACWSzOfHMNLFB-1Lbj7g_kqLVvKnM';
let sb=null, currentUser=null, profile=null, chats=[], activeChat=null, channel=null, receiptPoll=null, authMode='login', notificationChannel=null, unreadNotifications=0, totalXp=0, selectedAvatarEmoji='🙂', selectedAvatarPhoto=false, selectedCurtainColor='#5a3b8d', presenceChannel=null, onlineUsers=new Set(), typingTimer=null, mediaRecorder=null, voiceChunks=[], isRecordingVoice=false;
const DEVELOPER_USER_ID='3bc957da-10a5-4587-aa76-05f4d1d67bb2';
let lastSeenByUser=new Map(),lastSeenHeartbeatTimer=null,giftCatalog=[];
const $=id=>document.getElementById(id);
function toast(s){$('toast').textContent=s;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),2600)}
function initSupabase(){
 if(!window.supabase){$('authSubtitle').textContent='Не удалось загрузить клиент Supabase. Проверь подключение к интернету и перезапусти приложение.';return}
 sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
 $('authForm').classList.remove('hidden');
 sb.auth.getSession().then(({data,error})=>{if(error)console.warn(error);if(data.session)enterApp(data.session.user)});
}
function toggleAuthMode(){
 authMode=authMode==='login'?'signup':'login';$('username').classList.toggle('hidden',authMode!=='signup');
 $('authSubmit').textContent=authMode==='login'?'Войти':'Создать аккаунт';
 $('authSwitch').textContent=authMode==='login'?'Нет аккаунта? Зарегистрироваться':'Уже есть аккаунт? Войти';$('authError').textContent='';
}
async function submitAuth(){
 const email=$('email').value.trim(),password=$('password').value,username=$('username').value.trim().toLowerCase();
 $('authError').textContent='';
 try{
  if(!email||password.length<8)throw Error('Укажи почту и пароль не короче 8 символов.');
  if(authMode==='signup'){
   if(!/^[a-z0-9_]{3,20}$/.test(username))throw Error('Ник: 3–20 символов, латиница, цифры или _.');
   const {data,error}=await sb.auth.signUp({email,password,options:{data:{username}}});if(error)throw error;
   if(data.session)enterApp(data.user);else $('authError').textContent='Аккаунт создан. Подтверди почту по ссылке из письма, затем войди.';
  }else{const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;enterApp(data.user)}
 }catch(e){$('authError').textContent=e.message||'Ошибка авторизации'}
}
async function enterApp(user){
 currentUser=user;$('authScreen').classList.add('hidden');$('app').classList.remove('hidden');
 await loadProfile();startLastSeenTracking();await ensureDeveloperChat();await loadChats();await claimDailyXp();await loadUnreadNotifications();subscribeGlobalMessages();subscribeNotifications();
 sb.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){if(lastSeenHeartbeatTimer)clearInterval(lastSeenHeartbeatTimer);location.reload()}});
}
async function loadProfile(){
 const {data,error}=await sb.from('profiles').select('*').eq('id',currentUser.id).maybeSingle();
 if(error)throw error;profile=data;
 if(!profile){toast('Профиль не найден. Проверь SQL-настройку в Supabase.');return}
 $('myName').textContent='@'+profile.username;$('myEmail').textContent=currentUser.email||'';renderAvatar($('myAvatar'),profile);
}
async function updateMyLastSeen(){
 if(!currentUser||!sb)return;const stamp=new Date().toISOString();
 const {error}=await sb.from('profiles').update({last_seen_at:stamp}).eq('id',currentUser.id);
 if(error)console.warn('last_seen update:',error.message);else profile.last_seen_at=stamp;
}
function startLastSeenTracking(){
 updateMyLastSeen();if(lastSeenHeartbeatTimer)clearInterval(lastSeenHeartbeatTimer);
 lastSeenHeartbeatTimer=setInterval(updateMyLastSeen,60000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')updateMyLastSeen()});
 window.addEventListener('focus',updateMyLastSeen);
}
async function ensureDeveloperChat(){
 if(!currentUser||currentUser.id===DEVELOPER_USER_ID)return;
 try{const {error}=await sb.rpc('ensure_developer_chat');if(error)throw error;}
 catch(e){console.warn('Developer chat:',e.message||e);toast('Не удалось подготовить чат разработчика: '+(e.message||''));}
}

function renderAvatar(el,p){
 if(!el)return;el.style.backgroundImage='';el.style.backgroundSize='';el.textContent='';
 if(p?.avatar_url){el.style.backgroundImage='url('+p.avatar_url+')';el.style.backgroundSize='cover';return;}
 if(p?.avatar_emoji){el.textContent=p.avatar_emoji;el.classList.add('emoji-avatar');}else{el.textContent=(p?.username||'U')[0].toUpperCase();el.classList.remove('emoji-avatar');}
}
function safeColor(c){return /^#[0-9a-fA-F]{6}$/.test(c||'')?c:'#5a3b8d';}
let globalChannel=null;
function subscribeGlobalMessages(){
 if(globalChannel)sb.removeChannel(globalChannel);
 globalChannel=sb.channel('ugr-global-messages-'+currentUser.id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},async payload=>{
   const m=payload.new;if(m.sender_id===currentUser.id)return;
   sb.from('messages').update({delivered_at:new Date().toISOString()}).eq('id',m.id).is('delivered_at',null).then(({error})=>{if(error)console.warn('delivery receipt',error)});
   const c=chats.find(x=>x.id===m.conversation_id);if(c){c.last=m;renderChats();}
  })
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:'sender_id=eq.'+currentUser.id},payload=>{if(activeChat?.id===payload.new.conversation_id)refreshMessage(payload.new);})
  .subscribe();
 if(presenceChannel)sb.removeChannel(presenceChannel);
 presenceChannel=sb.channel('ugr-presence',{config:{presence:{key:currentUser.id}}});
 presenceChannel.on('presence',{event:'sync'},()=>{onlineUsers=new Set(Object.keys(presenceChannel.presenceState()));renderChats();if(activeChat)refreshChatStatus();});
 presenceChannel.subscribe(async status=>{if(status==='SUBSCRIBED'){await presenceChannel.track({user_id:currentUser.id,username:profile?.username,last_seen:new Date().toISOString()});}});
}
function isUserOnline(id){return onlineUsers.has(id)}
function subscribeNotifications(){
 if(notificationChannel)sb.removeChannel(notificationChannel);
 notificationChannel=sb.channel('ugr-notifications-'+currentUser.id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'recipient_id=eq.'+currentUser.id},payload=>{
   unreadNotifications++;updateNotificationBadge();
   const note=payload.new;
   if(!activeChat||activeChat.id!==note.conversation_id||!$('app').classList.contains('show-chat'))toast('🔔 '+(note.message||'Новое уведомление'));
  }).subscribe();
}
function updateNotificationBadge(){const b=$('notificationBadge');if(!b)return;b.textContent=unreadNotifications>99?'99+':unreadNotifications;b.classList.toggle('hidden',unreadNotifications===0)}
async function loadUnreadNotifications(){
 const {count,error}=await sb.from('notifications').select('id',{count:'exact',head:true}).is('read_at',null);
 if(!error){unreadNotifications=count||0;updateNotificationBadge();}
}
async function claimDailyXp(){
 const {data,error}=await sb.rpc('claim_daily_xp');
 if(error){console.warn('Daily XP:',error.message);return;}
 const result=Array.isArray(data)?data[0]:data;if(!result)return;
 totalXp=result.total_xp||0;
 if(result.awarded===10)toast('⭐ Ежедневная награда: +10 XP!');
}
async function openTop10(){
 $('modalTitle').textContent='🏆 TOP-10';$('modalBody').innerHTML='<div class="muted">Рейтинг всех зарегистрированных пользователей по накопленному XP. Только ники и очки — написать отсюда нельзя.</div><div id="top10List" class="form">Загружаем рейтинг…</div>';$('modal').classList.remove('hidden');
 const {data,error}=await sb.rpc('get_top10');const out=$('top10List');if(error){out.textContent='Не удалось загрузить рейтинг: '+error.message;return;}
 out.innerHTML='';(data||[]).forEach(item=>{const row=document.createElement('div');row.className='rank-row';const pos=document.createElement('div');pos.className='rank-num';pos.textContent=item.position;const name=document.createElement('div');name.className='rank-name';name.textContent=item.username;const xp=document.createElement('div');xp.className='rank-xp';xp.textContent=(item.xp||0)+' XP';row.append(pos,name,xp);out.append(row)});
 if(!data?.length)out.textContent='Пока нет участников рейтинга.';
}
async function openNotifications(){
 $('modalTitle').textContent='🔔 Уведомления';$('modalBody').innerHTML='<div id="notificationsList" class="form">Загружаем уведомления…</div>';$('modal').classList.remove('hidden');
 const {data,error}=await sb.from('notifications').select('id,message,conversation_id,created_at,read_at').order('created_at',{ascending:false}).limit(50);const out=$('notificationsList');if(error){out.textContent='Не удалось загрузить уведомления: '+error.message;return;}
 out.innerHTML='';if(!data?.length){out.textContent='Пока уведомлений нет.';return;}
 for(const n of data){const row=document.createElement('div');row.className='notification-row'+(!n.read_at?' unread':'');const msg=document.createElement('div');msg.textContent=n.message;const time=document.createElement('small');time.textContent=new Date(n.created_at).toLocaleString('ru-RU');row.append(msg,time);row.onclick=async()=>{if(!n.read_at)await sb.from('notifications').update({read_at:new Date().toISOString()}).eq('id',n.id);await loadUnreadNotifications();if(n.conversation_id){await loadChats();const c=chats.find(x=>x.id===n.conversation_id);if(c){closeModal();openChat(c);}}else openNotifications();};out.append(row);}
 await sb.from('notifications').update({read_at:new Date().toISOString()}).is('read_at',null);await loadUnreadNotifications();
}
async function loadChats(){
 const {data,error}=await sb.from('conversation_members').select('conversation_id').eq('user_id',currentUser.id);
 if(error){toast(error.message);return}
 const ids=[...new Set((data||[]).map(x=>x.conversation_id))];chats=[];
 for(const id of ids){
  const {data:members}=await sb.from('conversation_members').select('user_id').eq('conversation_id',id);
  const other=(members||[]).find(x=>x.user_id!==currentUser.id);if(!other)continue;
  let card=null;if(other.user_id===DEVELOPER_USER_ID){const {data:devCard}=await sb.rpc('get_developer_profile_card');card=Array.isArray(devCard)?devCard[0]:devCard;}else{const {data:cards}=await sb.rpc('get_profile_cards',{target_user_ids:[other.user_id]});card=cards?.[0]||null;}const {data:details}=await sb.rpc('get_public_profile_details',{target_user_id:other.user_id});const detail=Array.isArray(details)?details[0]:details;const p=card?{...card,...(detail||{}),...(other.user_id===DEVELOPER_USER_ID?card:{}),id:other.user_id}:null;
  const {data:last}=await sb.from('messages').select('body,created_at').eq('conversation_id',id).order('created_at',{ascending:false}).limit(1);
  if(p)chats.push({id,other:p,last:last?.[0]||null});
 }
 const idsForStatus=chats.map(c=>c.other.id||c.other.user_id).filter(Boolean);
 if(idsForStatus.length){const {data:seen,error:seenError}=await sb.rpc('get_profile_last_seen',{target_user_ids:idsForStatus});if(!seenError)(seen||[]).forEach(x=>lastSeenByUser.set(x.user_id,x.last_seen_at));else console.warn('last seen:',seenError.message)}
 chats.sort((a,b)=>{const ap=(a.other.id||a.other.user_id)===DEVELOPER_USER_ID,bp=(b.other.id||b.other.user_id)===DEVELOPER_USER_ID;if(ap!==bp)return ap?-1:1;return new Date(b.last?.created_at||0)-new Date(a.last?.created_at||0)});renderChats();
}
function formatLastSeen(value){
 if(!value)return 'Не в сети';const d=new Date(value);if(Number.isNaN(d.getTime()))return 'Не в сети';
 const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=new Date(d.getFullYear(),d.getMonth(),d.getDate());
 const time=d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
 if(now.getTime()-d.getTime()<5*60*1000)return 'Был в сети только что';
 if(day.getTime()===today.getTime())return 'Был сегодня в '+time;
 const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);if(day.getTime()===yesterday.getTime())return 'Был вчера в '+time;
 return 'Был '+d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})+' в '+time;
}
function getUserStatus(id){if(isUserOnline(id))return 'В сети';return formatLastSeen(lastSeenByUser.get(id))}
function renderChats(){
 const q=$('searchChats').value.toLowerCase(),list=$('chatList'),savedScroll=list.scrollTop;list.replaceChildren();
 chats.filter(c=>('@'+(c.other.username||'')).toLowerCase().includes(q)||((c.other.id||c.other.user_id)===DEVELOPER_USER_ID&&'разработчик ugr'.includes(q))).forEach(c=>{
  const personId=c.other.id||c.other.user_id,isDev=personId===DEVELOPER_USER_ID;
  const el=document.createElement('div');el.className='chat'+(activeChat?.id===c.id?' active':'')+(isDev?' pinned-developer':'');
  const av=c.other.avatar_url?document.createElement('img'):document.createElement('div');av.className=c.other.avatar_url?'profilepic':'avatar';renderAvatar(av,c.other);if(c.other.avatar_url)av.src=c.other.avatar_url;
  const info=document.createElement('div');info.className='chat-info';
  const top=document.createElement('div');top.className='chat-top';const n=document.createElement('span');n.className='chat-name';n.textContent=isDev?'Разработчик UGR':(c.other.profile_private?'Закрытый профиль':'@'+(c.other.username||'пользователь'));
  if(isDev){const chip=document.createElement('span');chip.className='developer-chip';chip.textContent='СОЗДАТЕЛЬ';n.append(chip)}
  const t=document.createElement('span');t.className='time';t.textContent=c.last?new Date(c.last.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
  const p=document.createElement('div');p.className='preview';p.textContent=c.last?.body|| (isDev?'Написать разработчику':'Начните переписку');
  const status=document.createElement('div');status.className='chat-status'+(isUserOnline(personId)?' online':'');status.textContent=getUserStatus(personId);
  top.append(n,t);info.append(top,p,status);el.append(av,info);el.onclick=()=>openChat(c);list.append(el);
 });
 list.scrollTop=savedScroll;
}
async function openFind(){
 $('modalTitle').textContent='Найти пользователя';$('modalBody').innerHTML='<input id="findInput" class="field" placeholder="Введи ник без @"><button class="primary" id="findButton">Искать</button><div id="findResults"></div>';$('modal').classList.remove('hidden');
 $('findButton').onclick=searchUsers;$('findInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchUsers()});
}
async function searchUsers(){
 const q=$('findInput').value.trim().replace(/^@/,'').toLowerCase();if(q.length<2){toast('Введи минимум 2 символа');return}
 const {data,error}=await sb.rpc('search_profiles',{search_term:q});
 const out=$('findResults');out.innerHTML='';if(error){out.textContent=error.message;return}
 if(!data?.length){out.textContent='Никого не нашли';return}
 data.forEach(p=>{const row=document.createElement('div');row.className='user-result';const av=document.createElement('div');av.className='avatar';renderAvatar(av,p);const name=document.createElement('div');name.className='grow';name.textContent='@'+p.username;name.style.cursor='pointer';name.onclick=()=>viewUserProfile(p.id);const btn=document.createElement('button');btn.className='smallbtn';btn.textContent='Профиль';btn.onclick=()=>viewUserProfile(p.id);const write=document.createElement('button');write.className='smallbtn';write.textContent='Написать';write.onclick=()=>startChat(p);row.append(av,name,btn,write);out.append(row)});
}
async function startChat(person){
 if(!person?.id||person.id===currentUser?.id){toast('Нельзя открыть чат с этим пользователем');return}
 try{const {data,error}=await sb.rpc('create_or_get_direct_conversation',{other_user_id:person.id});if(error)throw error;
  const conversationId=typeof data==='string'?data:(Array.isArray(data)?(data[0]?.id||data[0]?.conversation_id):(data?.id||data?.conversation_id));
  await loadChats();closeModal();let c=conversationId?chats.find(x=>x.id===conversationId):null;
  if(!c)c=chats.find(x=>x.other?.id===person.id||x.other?.user_id===person.id);
  if(c){openChat(c);return}
  // If the RPC returned a conversation but the membership list did not refresh yet, retry once.
  await new Promise(resolve=>setTimeout(resolve,250));await loadChats();
  c=conversationId?chats.find(x=>x.id===conversationId):chats.find(x=>x.other?.id===person.id||x.other?.user_id===person.id);
  if(c)openChat(c);else toast('Чат создан, но пока не отображается. Проверь создание участников чата в Supabase.');
 }catch(e){toast(e.message||'Не удалось создать чат')}
}
async function openChat(c){
 if(receiptPoll){clearInterval(receiptPoll);receiptPoll=null}
 if(channel){await sb.removeChannel(channel);channel=null}
 clearSelection();activeChat=c;const isDev=(c.other.id||c.other.user_id)===DEVELOPER_USER_ID;$('headName').textContent=isDev?'Разработчик UGR':'@'+(c.other.username||'пользователь');$('headStatus').textContent=getUserStatus(c.other.id||c.other.user_id);renderAvatar($('headAvatar'),c.other);$('headName').onclick=()=>viewUserProfile(c.other.id||c.other.user_id);$('headAvatar').onclick=()=>viewUserProfile(c.other.id||c.other.user_id);$('headName').style.cursor='pointer';$('headAvatar').style.cursor='pointer';$('headAvatar').classList.add('profile-card-open');
 $('messageInput').disabled=false;$('send').disabled=false;$('recordVoice').disabled=false;$('messages').innerHTML='<div class="empty">Загружаем сообщения…</div>';$('app').classList.add('show-chat');renderChats();
 channel=sb.channel('ugr-chat-'+c.id,{config:{broadcast:{self:false},presence:{key:currentUser.id}}})
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+c.id},payload=>{if(payload.new.sender_id!==currentUser.id){appendMessage(payload.new);markIncomingRead(c.id)}})
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:'conversation_id=eq.'+c.id},payload=>{refreshMessage(payload.new)})
  .on('broadcast',{event:'typing'},payload=>{if(payload.payload?.user_id!==currentUser.id){$('headStatus').textContent=payload.payload?.typing?'Печатает…':getUserStatus(c.other.id||c.other.user_id)}})
  .subscribe();
 await loadMessages(c.id);await markIncomingRead(c.id);refreshChatStatus();await refreshOwnMessageReceipts(c.id);receiptPoll=setInterval(()=>refreshOwnMessageReceipts(c.id),2200);
}
function refreshChatStatus(){if(!activeChat)return;const id=activeChat.other.id||activeChat.other.user_id;$('headStatus').textContent=getUserStatus(id);}
function broadcastTyping(value){if(!channel||!activeChat)return;channel.send({type:'broadcast',event:'typing',payload:{user_id:currentUser.id,typing:value}})}
async function loadMessages(id){
 const {data,error}=await sb.from('messages').select('id,conversation_id,sender_id,body,created_at,delivered_at,read_at,message_type,media_url,reactions').eq('conversation_id',id).order('created_at',{ascending:true}).limit(500);
 if(error){toast(error.message);return}
 $('messages').innerHTML='';(data||[]).forEach(appendMessage);scrollMessages();
}
let selectedMessageIds=new Set(),longPressTimer=null;
function appendMessage(m){
 if(!$('messages')||!m?.id||document.querySelector('[data-id="'+m.id+'"]'))return;const b=document.createElement('div');b.className='bubble'+(m.sender_id===currentUser.id?' mine':'');b.dataset.id=m.id;
 const body=document.createElement('div');body.className='msg-content';if(m.message_type==='voice'&&m.media_url){body.append(buildVoicePlayer(m.media_url,m.id));}else body.textContent=m.body||'';
 const tm=document.createElement('div');tm.className='msg-time';tm.textContent=new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});if(m.sender_id===currentUser.id){const mark=document.createElement('span');mark.className='readmark';mark.dataset.read='';mark.textContent=m.read_at?'🙉 прочитано':m.delivered_at?'🙊 доставлено':'🙈 отправлено';tm.append(mark)}b.append(body,tm);
 const rx=document.createElement('div');rx.className='message-tools reactions';const current=normalizeReactions(m.reactions);Object.entries(current).forEach(([e,users])=>{if(users.length){const r=document.createElement('button');r.type='button';r.className='reaction-chip'+(users.includes(currentUser.id)?' mine':'');r.textContent=e+' '+users.length;r.onclick=(ev)=>{ev.stopPropagation();toggleReaction(m.id,e)};rx.append(r)}});if(rx.childElementCount)b.append(rx);
 b.addEventListener('contextmenu',e=>{e.preventDefault();selectMessage(m.id)});b.addEventListener('click',e=>{if(e.target.closest('button')||e.target.closest('.voice-wave'))return;if(selectedMessageIds.size)toggleMessageSelection(m.id)});b.addEventListener('touchstart',()=>{longPressTimer=setTimeout(()=>selectMessage(m.id),520)},{passive:true});b.addEventListener('touchend',()=>clearTimeout(longPressTimer));b.addEventListener('touchmove',()=>clearTimeout(longPressTimer));
 $('messages').append(b);scrollMessages();
}
function buildVoicePlayer(url,id){const card=document.createElement('div');card.className='voice-card';const audio=document.createElement('audio');audio.src=url;audio.preload='metadata';const play=document.createElement('button');play.type='button';play.className='voice-play';play.textContent='▶';const mid=document.createElement('div');mid.className='voice-mid';const wave=document.createElement('div');wave.className='voice-wave';const heights=[8,15,22,12,27,18,24,11,19,28,16,22,10,25,14,20,29,13,23,17,8,21,12,26,18,24,10,16,28,13,19,7,23,14,27,11,20,16,25,9,18,22,12,29];heights.forEach(h=>{const bar=document.createElement('span');bar.style.height=h+'px';wave.append(bar)});const time=document.createElement('div');time.className='voice-time';time.textContent='00:00';mid.append(wave,time);card.append(play,mid,audio);const fmt=n=>{if(!isFinite(n))return'0:00';return Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0')};function draw(){time.textContent=fmt(audio.duration).replace(/^([0-9]):/,'0$1:');const pct=audio.duration?audio.currentTime/audio.duration:0;wave.querySelectorAll('span').forEach((bar,i)=>bar.classList.toggle('played',i/ heights.length<pct))}audio.addEventListener('loadedmetadata',draw);audio.addEventListener('timeupdate',draw);audio.addEventListener('ended',()=>play.textContent='▶');play.onclick=()=>{if(audio.paused){document.querySelectorAll('.voice-card audio').forEach(a=>{if(a!==audio)a.pause()});audio.play().then(()=>play.textContent='Ⅱ').catch(()=>toast('Не удалось воспроизвести аудио'));}else{audio.pause();play.textContent='▶'}};wave.onclick=e=>{if(!audio.duration)return;const r=wave.getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(audio.duration,(e.clientX-r.left)/r.width*audio.duration))};return card}
function refreshMessage(m){const old=document.querySelector('[data-id="'+m.id+'"]');if(!old)return;const list=$('messages'),next=old.nextSibling,scrollTop=list.scrollTop,atBottom=list.scrollHeight-list.clientHeight-scrollTop<50;old.remove();selectedMessageIds.delete(m.id);appendMessage(m);const fresh=document.querySelector('[data-id="'+m.id+'"]');if(fresh&&next&&next.parentNode===list)list.insertBefore(fresh,next);if(!atBottom)list.scrollTop=scrollTop}
function chooseReaction(id){const bubble=document.querySelector('[data-id="'+id+'"]');if(!bubble)return;let picker=bubble.querySelector('.reaction-picker');if(picker){picker.remove();return}picker=document.createElement('div');picker.className='reaction-picker message-tools';['❤️','🔥','👍','👎','😮','😂','😭','👏','🎉','🤡','💀','🥰','🤔','🙏','🤯','✨','🫡','🫶'].forEach(e=>{const b=document.createElement('button');b.className='reaction-chip';b.type='button';b.textContent=e;b.onclick=()=>{picker.remove();toggleReaction(id,e)};picker.append(b)});bubble.append(picker)}
function selectMessage(id){selectedMessageIds.add(id);document.querySelector('[data-id="'+id+'"]').classList.add('selected');showSelectionBar();chooseReaction(id)}
function toggleMessageSelection(id){if(selectedMessageIds.has(id)){selectedMessageIds.delete(id);document.querySelector('[data-id="'+id+'"]').classList.remove('selected')}else{selectMessage(id)}showSelectionBar()}
function showSelectionBar(){let bar=$('chatSelectionBar');if(!bar){bar=document.createElement('div');bar.id='chatSelectionBar';bar.className='chat-selection-bar';$('composer-wrap')?.before(bar)}bar.innerHTML='';if(!selectedMessageIds.size){bar.remove();return}const count=document.createElement('span');count.className='selection-count';count.textContent='Выбрано: '+selectedMessageIds.size;bar.append(count);[['✕','Отмена',()=>clearSelection()],['😊','Реакция',()=>{if(selectedMessageIds.size===1)chooseReaction([...selectedMessageIds][0])}],['📋','Копировать',async()=>{const texts=[...selectedMessageIds].map(id=>document.querySelector('[data-id="'+id+'"] .msg-content')?.innerText||'').join('\n');try{await navigator.clipboard.writeText(texts);toast('Скопировано')}catch{toast('Не удалось скопировать')}clearSelection()}]].forEach(([icon,label,fn])=>{const btn=document.createElement('button');btn.textContent=icon+' '+label;btn.onclick=fn;bar.append(btn)})}
function clearSelection(){selectedMessageIds.forEach(id=>document.querySelector('[data-id="'+id+'"]').classList.remove('selected'));selectedMessageIds.clear();$('chatSelectionBar')?.remove()}
function normalizeReactions(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return{};
 const out={};for(const [emoji,users] of Object.entries(value)){if(Array.isArray(users))out[emoji]=[...new Set(users.filter(x=>typeof x==='string'))];}
 return out;
}
async function toggleReaction(id,emoji){
 const {data,error}=await sb.from('messages').select('reactions').eq('id',id).single();
 if(error){toast('Не удалось загрузить реакции: '+error.message);return}
 const reactions=normalizeReactions(data?.reactions),users=reactions[emoji]||[];
 reactions[emoji]=users.includes(currentUser.id)?users.filter(x=>x!==currentUser.id):[...users,currentUser.id];
 if(!reactions[emoji].length)delete reactions[emoji];
 const {data:updated,error:up}=await sb.from('messages').update({reactions}).eq('id',id).select('id,conversation_id,sender_id,body,created_at,delivered_at,read_at,message_type,media_url,reactions').single();
 if(up){toast('Реакция не сохранилась: '+up.message);return}
 if(updated)refreshMessage(updated);
}

function scrollMessages(){$('messages').scrollTop=$('messages').scrollHeight}
async function markIncomingRead(conversationId){
 const now=new Date().toISOString();
 const {error}=await sb.from('messages').update({delivered_at:now,read_at:now}).eq('conversation_id',conversationId).neq('sender_id',currentUser.id).is('read_at',null);
 if(error)console.warn('read receipt',error);
}
function updateReadMark(m){const node=document.querySelector('[data-id="'+m.id+'"] [data-read]');if(node)node.textContent=m.read_at?'🙉 прочитано':m.delivered_at?'🙊 доставлено':'🙈 отправлено'}
async function refreshOwnMessageReceipts(conversationId){
 if(!currentUser||activeChat?.id!==conversationId)return;
 const {data,error}=await sb.from('messages').select('id,delivered_at,read_at').eq('conversation_id',conversationId).eq('sender_id',currentUser.id).order('created_at',{ascending:false}).limit(100);
 if(error){console.warn('receipt refresh',error);return}
 (data||[]).forEach(updateReadMark);
}

async function sendMessage(){
 const input=$('messageInput'),body=input.value.trim();if(!body||!activeChat)return;
 input.value='';input.style.height='42px';
 const {data,error}=await sb.from('messages').insert({conversation_id:activeChat.id,sender_id:currentUser.id,body,message_type:'text'}).select().single();
 if(error){input.value=body;toast(error.message);return}
 appendMessage(data);const c=chats.find(x=>x.id===activeChat.id);if(c){c.last=data;renderChats()}
}
let voiceTimerInterval=null,voiceRecordStartedAt=0,voiceRecordPanel=null,voiceStream=null,voiceDiscard=false;
function voiceElapsed(){const sec=Math.floor((Date.now()-voiceRecordStartedAt)/1000);return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}
function showVoiceRecordPanel(){const wrap=document.querySelector('.composer-wrap'),composer=$('.composer');if(!wrap||!composer)return;voiceRecordPanel=document.createElement('div');voiceRecordPanel.className='voice-record-panel';voiceRecordPanel.innerHTML='<span class="record-dot"></span><span class="voice-record-timer">00:00</span><button class="voice-cancel">ОТМЕНА</button><button class="voice-send">➤</button>';composer.replaceWith(voiceRecordPanel);voiceRecordPanel.querySelector('.voice-cancel').onclick=()=>cancelVoiceRecording();voiceRecordPanel.querySelector('.voice-send').onclick=()=>finishVoiceRecording(true);}
function restoreVoiceComposer(){if(voiceRecordPanel){const wrap=document.querySelector('.composer-wrap');voiceRecordPanel.remove();const c=document.createElement('div');c.className='composer';c.innerHTML='<textarea id="messageInput" rows="1" placeholder="Написать сообщение..." disabled></textarea><button class="record-btn" id="recordVoice" onclick="toggleVoiceRecording()" title="Записать голосовое" disabled>🎙</button><button class="send" id="send" onclick="sendMessage()" disabled>➤</button>';wrap.insertBefore(c,wrap.firstChild);$('messageInput').disabled=!activeChat;$('recordVoice').disabled=!activeChat;$('send').disabled=!activeChat;$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});$('messageInput').addEventListener('input',e=>{e.target.style.height='42px';e.target.style.height=Math.min(e.target.scrollHeight,110)+'px';broadcastTyping(true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>broadcastTyping(false),1500)});voiceRecordPanel=null;}}
async function finishVoiceRecording(send){if(!mediaRecorder||mediaRecorder.state==='inactive')return;voiceDiscard=!send;clearInterval(voiceTimerInterval);voiceTimerInterval=null;isRecordingVoice=false;mediaRecorder.stop();}
function cancelVoiceRecording(){finishVoiceRecording(false)}
async function toggleVoiceRecording(){
 if(isRecordingVoice){finishVoiceRecording(true);return}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('Запись голосовых не поддерживается этим браузером');return}
 try{voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});voiceChunks=[];mediaRecorder=new MediaRecorder(voiceStream);mediaRecorder.ondataavailable=e=>{if(e.data.size)voiceChunks.push(e.data)};mediaRecorder.onstop=async()=>{voiceStream?.getTracks().forEach(t=>t.stop());voiceStream=null;const blob=new Blob(voiceChunks,{type:mediaRecorder.mimeType||'audio/webm'});restoreVoiceComposer();if(voiceDiscard){voiceChunks=[];return}if(blob.size>15*1024*1024){toast('Голосовое слишком большое (лимит 15 МБ)');return}await uploadVoice(blob)};mediaRecorder.start();voiceRecordStartedAt=Date.now();isRecordingVoice=true;voiceDiscard=false;showVoiceRecordPanel();voiceTimerInterval=setInterval(()=>{const t=voiceRecordPanel?.querySelector('.voice-record-timer');if(t)t.textContent=voiceElapsed()},250);}catch(e){toast('Нет доступа к микрофону: '+(e.message||e))}}
async function uploadVoice(blob){if(!activeChat)return;const ext=blob.type.includes('ogg')?'ogg':blob.type.includes('mp4')?'m4a':'webm';const path=currentUser.id+'/'+activeChat.id+'/'+Date.now()+'.'+ext;const {error:up}=await sb.storage.from('ugr-voice').upload(path,blob,{upsert:false,contentType:blob.type||'audio/webm'});if(up){toast('Ошибка загрузки голосового: '+up.message);return}const {data:url}=sb.storage.from('ugr-voice').getPublicUrl(path);const {data,error}=await sb.from('messages').insert({conversation_id:activeChat.id,sender_id:currentUser.id,body:'Голосовое сообщение',message_type:'voice',media_url:url.publicUrl}).select().single();if(error){toast('Не удалось отправить голосовое: '+error.message);return}appendMessage(data);const c=chats.find(x=>x.id===activeChat.id);if(c){c.last=data;renderChats()}}
function backToChats(){if(receiptPoll){clearInterval(receiptPoll);receiptPoll=null}$('app').classList.remove('show-chat')}
function closeModal(){$('modal').classList.add('hidden')}
async function openProfile(){
 if(!profile){toast('Профиль ещё загружается');return}
 $('modalTitle').textContent='Мой профиль';
 $('modalBody').innerHTML=`<div class="profile-view">
 <div class="profile-edit-preview"><div class="profile-hero"><div class="profile-hero-avatar" id="previewAvatar">U</div><div class="profile-display-name" id="previewDisplayName"></div><div class="profile-username" id="previewNick"></div><div class="profile-status">Так профиль видят другие</div></div><div class="profile-curtain-stage" id="curtainPreview"><div class="curtain left"></div><div class="curtain right"></div></div></div>
 <div class="profile-action-row self-profile-actions"><button class="profile-action" type="button" onclick="document.getElementById('avatarFile').click()"><span class="action-icon">📷</span><span>Выбрать фото</span></button><button class="profile-action" type="button" onclick="document.getElementById('displayName').focus();document.getElementById('displayName').scrollIntoView({behavior:'smooth',block:'center'})"><span class="action-icon">✎</span><span>Изменить</span></button><button class="profile-action" type="button" onclick="document.getElementById('privacyProfileSection').scrollIntoView({behavior:'smooth',block:'center'})"><span class="action-icon">⚙</span><span>Настройки</span></button><button class="profile-action curtain-quick-action" type="button" onclick="toggleCurtains()"><span class="action-icon">🪟</span><span id="curtainQuickLabel">Закрыть шторками</span></button></div>
 <div class="profile-section compact-curtain" id="privacyProfileSection"><div class="profile-section-title">Шторки профиля</div><div class="curtain-controls"><button class="smallbtn" id="curtainButton" onclick="toggleCurtains()">Закрыть шторками</button><label title="Цвет штор"><input id="curtainColor" type="color" value="#594080" onchange="previewCurtainColor(this.value)"></label></div></div>
 <div class="profile-section"><div class="profile-section-title">Аватар</div><div class="muted">Эмодзи или фото (до 5 МБ)</div><details class="emoji-fold" open><summary>Выбрать эмодзи</summary><div class="emoji-picker" id="emojiPicker"></div></details><input id="avatarFile" type="file" accept="image/*" style="display:none"></div>
 <div class="profile-section"><div class="profile-section-title">🎁 Моя коллекция подарков</div><div id="myGiftCollection" class="gift-collection"><span class="muted">Загружаем коллекцию…</span></div></div><div class="profile-section"><div class="profile-section-title">Данные профиля</div><div class="profile-edit-grid"><label class="muted">Уникальный ник</label><input id="profileUsername" class="field" maxlength="20"><label class="muted">Отображаемое имя</label><input id="displayName" class="field" maxlength="40"><label class="muted">О себе</label><textarea id="bio" class="field" maxlength="240" rows="3" placeholder="Расскажи немного о себе"></textarea><button class="primary" onclick="saveProfile()">Сохранить изменения</button><button class="link" onclick="signOut()">Выйти из аккаунта</button></div></div></div>`;
 $('modal').classList.remove('hidden');loadGiftCollection($('myGiftCollection'),currentUser.id);$('profileUsername').value=profile.username||'';$('displayName').value=profile.display_name||'';$('bio').value=profile.bio||'';
 selectedAvatarEmoji=profile.avatar_emoji||'🙂';selectedAvatarPhoto=!!profile.avatar_url;selectedCurtainColor=safeColor(profile.curtain_color);$('curtainColor').value=selectedCurtainColor;$('curtainPreview').style.setProperty('--curtain-base',selectedCurtainColor);
 $('previewNick').textContent='@'+(profile.username||'username');$('previewDisplayName').textContent=profile.display_name||'';renderAvatar($('previewAvatar'),profile);$('avatarFile').onchange=()=>{const f=$('avatarFile').files?.[0];if(f){selectedAvatarPhoto=true;const u=URL.createObjectURL(f);$('previewAvatar').innerHTML='';const img=document.createElement('img');img.src=u;$('previewAvatar').append(img)}};buildEmojiPicker();updateCurtainButton();
}
const AVATAR_EMOJIS=['🙂','😎','😈','👻','🐸','🐱','🐼','🦊','🐧','🐥','🦋','🐉','💀','🤡','🤖','👑','🔥','⭐','🌙','❤️','💜','⚡','🍀','🎭'];
function buildEmojiPicker(){const box=$('emojiPicker');box.innerHTML='';AVATAR_EMOJIS.forEach(e=>{const b=document.createElement('button');b.type='button';b.className='emoji-choice'+(e===selectedAvatarEmoji?' selected':'');b.textContent=e;b.onclick=()=>{selectedAvatarEmoji=e;selectedAvatarPhoto=false;$('avatarFile').value='';$('previewAvatar').innerHTML='';$('previewAvatar').textContent=e;$('previewAvatar').classList.add('emoji-avatar');buildEmojiPicker()};box.append(b)})}
function previewCurtainColor(color){selectedCurtainColor=safeColor(color);$('curtainPreview').style.setProperty('--curtain-base',selectedCurtainColor)}
function updateCurtainButton(){const closed=!!profile?.profile_private;if($('curtainButton'))$('curtainButton').textContent=closed?'Открыть шторки':'Закрыть шторками';if($('curtainQuickLabel'))$('curtainQuickLabel').textContent=closed?'Открыть шторки':'Закрыть шторками';$('curtainPreview')?.classList.toggle('closed',closed)}
async function viewUserProfile(userId){
 if(!userId){toast('Не удалось определить пользователя');return}
 if(userId===currentUser?.id){await openProfile();return}
 try{
 const {data,error}=await sb.rpc('get_public_profile_details',{target_user_id:userId});if(error)throw error;const p=Array.isArray(data)?data[0]:data;if(!p){toast('Профиль недоступен');return}
 const closed=!!p.profile_private;const online=typeof isUserOnline==='function'&&isUserOnline(userId);const {data:seenData}=await sb.rpc('get_profile_last_seen',{target_user_ids:[userId]});const seenRow=(seenData||[])[0];if(seenRow?.last_seen_at)lastSeenByUser.set(userId,seenRow.last_seen_at);const statusText=online?'В сети':formatLastSeen(seenRow?.last_seen_at);
 $('modalTitle').textContent='Профиль';
 $('modalBody').innerHTML=`<div class="profile-view" id="foreignProfile"><div class="profile-curtain-stage ${closed?'closed':''}" id="publicCurtainPreview"><div class="curtain left"></div><div class="curtain right"></div></div><div class="profile-hero"><div class="profile-hero-avatar" id="publicPreviewAvatar"></div><div class="profile-display-name" id="publicDisplayName"></div><div class="profile-username" id="publicPreviewNick"></div><div class="profile-status ${online?'':'offline'}" id="publicStatus">● ${statusText}</div></div><div class="profile-action-row"><button class="profile-action" id="publicCallButton"><span class="action-icon">☎</span><span>Звонок</span></button><button class="profile-action" id="publicWriteButton"><span class="action-icon">✉</span><span>Чат</span></button><button class="profile-action" id="publicMoreButton"><span class="action-icon">•••</span><span>Ещё</span></button></div><div class="profile-section"><div class="profile-section-title">Информация о себе</div><div class="profile-section-value" id="publicBio">${closed?'': 'Нет информации о себе'}</div></div><div class="profile-section" id="publicMeta"><div class="profile-section-title">Информация</div><div class="profile-meta-row"><span>Имя пользователя</span><strong id="metaUsername"></strong></div><div class="profile-meta-row" id="joinedRow"><span>В UGR с</span><strong id="metaJoined">—</strong></div></div><div class="profile-section"><div class="profile-section-title">🎁 Подарки</div><div id="publicGiftCollection" class="gift-collection"><span class="muted">Загружаем коллекцию…</span></div></div><div class="profile-section"><div class="profile-section-title">Медиа</div><div class="profile-section-value muted" id="publicMedia">Медиафайлы появятся здесь, когда будет подключён общий медиакаталог.</div></div></div>`;
 $('modal').classList.remove('hidden');$('publicCurtainPreview').style.setProperty('--curtain-base',safeColor(p.curtain_color));$('publicDisplayName').textContent=closed?'Профиль скрыт':(p.display_name||p.username||'Пользователь');$('publicPreviewNick').textContent=closed?'':('@'+(p.username||'пользователь'));$('metaUsername').textContent=closed?'Скрыт':'@'+(p.username||'—');$('publicBio').textContent=closed?'Информация скрыта владельцем':(p.bio||'Нет информации о себе');
 if(p.created_at){$('metaJoined').textContent=new Date(p.created_at).toLocaleDateString('ru-RU',{year:'numeric',month:'long',day:'numeric'})}else{$('joinedRow').classList.add('hidden')}
 if(!closed){renderAvatar($('publicPreviewAvatar'),p);$('publicPreviewAvatar').classList.toggle('emoji-avatar',!p.avatar_url);}else{$('publicPreviewAvatar').textContent='🔒';$('publicPreviewAvatar').style.filter='blur(2px)'}
 $('publicWriteButton').onclick=()=>startChat({id:userId,...p});loadGiftCollection($('publicGiftCollection'),userId);
 $('publicCallButton').onclick=()=>toast('Звонки пока не подключены к UGR MESSENGER');
 $('publicMoreButton').onclick=()=>{const action=confirm('Скопировать ссылку на профиль @'+(p.username||'пользователь')+'?');if(action){const url=location.origin+location.pathname+'?user='+encodeURIComponent(p.username||'');if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(()=>toast('Ссылка скопирована')).catch(()=>toast(url));else toast(url)}};
 }catch(e){toast('Не удалось открыть профиль: '+(e.message||e))}
}
async function toggleCurtains(){
 const next=!profile.profile_private;const {data,error}=await sb.from('profiles').update({profile_private:next}).eq('id',currentUser.id).select().single();
 if(error){toast('Не удалось изменить приватность: '+error.message);return;}profile=data;updateCurtainButton();toast(next?'Профиль закрыт шторками':'Профиль открыт');
}
async function saveProfile(){
 const username=$('profileUsername').value.trim().toLowerCase(),display_name=$('displayName').value.trim(),bio=$('bio').value.trim();
 if(!/^[a-z0-9_]{3,20}$/.test(username)){toast('Ник: 3–20 символов, латиница, цифры или _');return}
 let avatar_url=selectedAvatarPhoto?profile.avatar_url:null;const file=$('avatarFile')?.files?.[0];if(file){if(file.size>5*1024*1024){toast('Фото должно быть меньше 5 МБ');return}const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase()||'jpg',path=currentUser.id+'/'+Date.now()+'.'+ext;const {error:upErr}=await sb.storage.from('ugr-avatars').upload(path,file,{upsert:true,contentType:file.type||'image/jpeg'});if(upErr){toast('Не удалось загрузить фото: '+upErr.message);return}const {data:urlData}=sb.storage.from('ugr-avatars').getPublicUrl(path);avatar_url=urlData.publicUrl;selectedAvatarPhoto=true;}
 const {data,error}=await sb.from('profiles').update({username,display_name,bio,avatar_url,avatar_emoji:selectedAvatarPhoto?null:selectedAvatarEmoji,curtain_color:selectedCurtainColor,profile_private:!!profile.profile_private}).eq('id',currentUser.id).select().single();
 if(error){toast('Не удалось сохранить. Возможно, сначала нужно добавить новые поля в Supabase: '+error.message);return}profile=data;$('myName').textContent='@'+profile.username;renderAvatar($('myAvatar'),profile);closeModal();toast('Профиль сохранён');
}
async function openDeveloperProfile(){await viewUserProfileByUsername('ugr_creator')}
async function openDeveloperChat(){try{const {data,error}=await sb.rpc('search_profiles',{search_term:'ugr_creator'});if(error)throw error;const p=(data||[]).find(x=>x.username==='ugr_creator');if(!p){toast('Профиль разработчика пока не найден');return}await startChat(p)}catch(e){toast(e.message||'Не удалось открыть чат с разработчиком')}}
async function viewUserProfileByUsername(username){try{const {data,error}=await sb.rpc('search_profiles',{search_term:username});if(error)throw error;const p=(data||[]).find(x=>x.username===username);if(!p){toast('Профиль @'+username+' пока не найден');return}await viewUserProfile(p.id)}catch(e){toast(e.message||'Не удалось открыть профиль разработчика')}}

async function refreshMyXp(){
 const {data,error}=await sb.from('user_xp').select('xp').eq('user_id',currentUser.id).maybeSingle();
 if(error){console.warn('XP balance:',error.message);return totalXp}totalXp=Number(data?.xp||0);return totalXp;
}
async function openGiftShop(){
 $('modalTitle').textContent='🎁 UGR Gifts';$('modalBody').innerHTML='<div class="muted">Загружаем подарки…</div>';$('modal').classList.remove('hidden');
 try{const [cat]=await Promise.all([sb.from('ugr_gift_catalog').select('gift_key,title,emoji,description,price_xp,rarity').eq('active',true).order('sort_order')]);if(cat.error)throw cat.error;giftCatalog=cat.data||[];const xp=await refreshMyXp();
  $('modalBody').innerHTML=`<div class="row" style="justify-content:space-between;align-items:center"><div class="muted">Покупай подарки за ежедневные и накопленные XP.</div><strong id="giftXpBalance">⭐ ${xp} XP</strong></div><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="smallbtn" id="giftHistoryButton">История подарков</button></div><div class="gift-grid" id="giftGrid"></div>`;
  $('giftHistoryButton').onclick=openGiftHistory;const grid=$('giftGrid');giftCatalog.forEach(g=>{const card=document.createElement('div');card.className='gift-card';card.innerHTML=`<div class="gift-rarity">${escapeHtml(g.rarity||'Обычный')}</div><div class="gift-art">${escapeHtml(g.emoji||'🎁')}</div><div class="gift-title">${escapeHtml(g.title)}</div><div class="gift-description">${escapeHtml(g.description||'Подарок для профиля')}</div><div class="gift-price">⭐ ${Number(g.price_xp)} XP</div><button class="smallbtn">Подарить</button>`;card.querySelector('button').onclick=()=>openGiftRecipient(g.gift_key);grid.append(card)});
  if(!giftCatalog.length)grid.textContent='Каталог пока пуст.';
 }catch(e){$('modalBody').textContent='Не удалось загрузить магазин: '+(e.message||e)}
}
async function openGiftRecipient(giftKey){
 const g=giftCatalog.find(x=>x.gift_key===giftKey);if(!g)return;
 $('modalTitle').textContent='Кому отправить подарок?';$('modalBody').innerHTML=`<div class="gift-card" style="max-width:360px;margin:0 auto"><div class="gift-art">${escapeHtml(g.emoji)}</div><div class="gift-title">${escapeHtml(g.title)}</div><div class="gift-price">⭐ ${Number(g.price_xp)} XP</div></div><input id="giftRecipientSearch" class="field" placeholder="Ник пользователя без @" style="margin-top:14px"><button class="primary" id="giftRecipientFind">Найти пользователя</button><div id="giftRecipientResults" class="form"></div><button class="link" id="giftBackToShop">← Назад в магазин</button>`;
 $('giftRecipientFind').onclick=async()=>{const q=$('giftRecipientSearch').value.trim().replace(/^@/,'').toLowerCase();if(q.length<2){toast('Введи минимум 2 символа ника');return}const {data,error}=await sb.rpc('search_profiles',{search_term:q});const out=$('giftRecipientResults');out.innerHTML='';if(error){out.textContent=error.message;return}const people=(data||[]).filter(x=>x.id!==currentUser.id);if(!people.length){out.textContent='Пользователь не найден';return}people.forEach(person=>{const row=document.createElement('div');row.className='user-result';const av=document.createElement('div');av.className='avatar';renderAvatar(av,person);const name=document.createElement('div');name.className='grow';name.textContent='@'+(person.username||'пользователь');const btn=document.createElement('button');btn.className='smallbtn';btn.textContent='Отправить';btn.onclick=()=>sendUgrGift(giftKey,person.id,person.username);row.append(av,name,btn);out.append(row)})};
 $('giftRecipientSearch').addEventListener('keydown',e=>{if(e.key==='Enter')$('giftRecipientFind').click()});$('giftBackToShop').onclick=openGiftShop;
}
async function sendUgrGift(giftKey,recipientId,username){
 const g=giftCatalog.find(x=>x.gift_key===giftKey);if(!g)return;if(!confirm(`Отправить «${g.title}» пользователю @${username||'пользователь'} за ${g.price_xp} XP?`))return;
 try{const {data,error}=await sb.rpc('send_ugr_gift',{p_gift_key:giftKey,p_recipient_id:recipientId,p_message:null});if(error)throw error;const result=Array.isArray(data)?data[0]:data;totalXp=Number(result?.remaining_xp??totalXp);toast(`🎁 Подарок отправлен пользователю @${username||'пользователь'}!`);openGiftShop();}
 catch(e){toast('Не удалось отправить подарок: '+(e.message||e))}
}
async function loadGiftCollection(container,userId){
 if(!container)return;const {data,error}=await sb.from('ugr_user_gifts').select('gift_key,created_at,sender_id,message').eq('recipient_id',userId).order('created_at',{ascending:false}).limit(60);
 if(error){container.textContent='Коллекция пока недоступна';console.warn('Gift collection:',error.message);return}
 if(!data?.length){container.innerHTML='<span class="muted">Пока нет подарков</span>';return}
 const keys=[...new Set(data.map(x=>x.gift_key))],senders=[...new Set(data.map(x=>x.sender_id).filter(Boolean))];const [{data:items},{data:people}]=await Promise.all([sb.from('ugr_gift_catalog').select('gift_key,title,emoji').in('gift_key',keys),sb.rpc('get_profile_cards',{target_user_ids:senders})]);const map=new Map((items||[]).map(x=>[x.gift_key,x])),peopleMap=new Map((people||[]).map(x=>[x.id,x]));container.innerHTML='';data.forEach(item=>{const g=map.get(item.gift_key)||{title:item.gift_key,emoji:'🎁'},p=peopleMap.get(item.sender_id);const el=document.createElement('div');el.className='gift-collection-item';el.innerHTML=`<div class="gift-art">${escapeHtml(g.emoji)}</div><strong>${escapeHtml(g.title)}</strong><small>${new Date(item.created_at).toLocaleDateString('ru-RU')}</small>`;if(p){const a=document.createElement('button');a.type='button';a.className='gift-sender-avatar';a.title='Подарил(а): '+(p.display_name||p.username||'пользователь');if(p.avatar_url){const img=document.createElement('img');img.src=p.avatar_url;img.alt='';a.append(img)}else a.textContent=p.avatar_emoji||'🙂';a.onclick=()=>viewUserProfile(item.sender_id);el.append(a)}container.append(el)});
}
async function openGiftHistory(){
 $('modalTitle').textContent='🎁 История подарков';$('modalBody').innerHTML='<div class="muted">Загружаем историю…</div>';
 const {data,error}=await sb.from('ugr_user_gifts').select('id,gift_key,sender_id,recipient_id,xp_spent,message,created_at').or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`).order('created_at',{ascending:false}).limit(100);
 if(error){$('modalBody').textContent='Не удалось загрузить историю: '+error.message;return}if(!data?.length){$('modalBody').textContent='История пока пуста.';return}
 const keys=[...new Set(data.map(x=>x.gift_key))];const {data:items}=await sb.from('ugr_gift_catalog').select('gift_key,title,emoji').in('gift_key',keys);const map=new Map((items||[]).map(x=>[x.gift_key,x]));const ids=[...new Set(data.map(x=>x.sender_id===currentUser.id?x.recipient_id:x.sender_id))];const {data:people}=await sb.rpc('get_profile_cards',{target_user_ids:ids});const peopleMap=new Map((people||[]).map(x=>[x.id,x]));const out=document.createElement('div');
 data.forEach(item=>{const g=map.get(item.gift_key)||{title:item.gift_key,emoji:'🎁'};const row=document.createElement('div');row.className='gift-history-row';const art=document.createElement('div');art.className='gift-art';art.textContent=g.emoji;const text=document.createElement('div');text.className='grow';const outgoing=item.sender_id===currentUser.id,person=peopleMap.get(outgoing?item.recipient_id:item.sender_id),counterpart=person?.username?'@'+person.username:'закрытый профиль';text.innerHTML=`<strong>${outgoing?'Ты отправил(а)':'Тебе отправили'}: ${escapeHtml(g.title)}</strong><div class="muted">${outgoing?'Кому: ':'От: '}${escapeHtml(counterpart)} · ${new Date(item.created_at).toLocaleString('ru-RU')} · ${Number(item.xp_spent)} XP</div>`;row.append(art,text);out.append(row)});
 $('modalBody').replaceChildren(out);const back=document.createElement('button');back.className='link';back.textContent='← В магазин';back.onclick=openGiftShop;$('modalBody').append(back);
}

const UGR_PET_VISUALS={
 shadow_cat:{emoji:'🐈‍⬛',name:'Теневой кот',rarity:'Обычный',color:'#9d8cb8'},
 frost_fox:{emoji:'🦊',name:'Морозный лис',rarity:'Редкий',color:'#8bbde8'},
 cyber_bunny:{emoji:'🐰',name:'Кибер-кролик',rarity:'Обычный',color:'#c58bff'},
 magma_drake:{emoji:'🐲',name:'Магма-дракончик',rarity:'Эпический',color:'#f08b5a'},
 moon_owl:{emoji:'🦉',name:'Лунная сова',rarity:'Редкий',color:'#9b9af2'},
 void_slime:{emoji:'🟣',name:'Слайм Пустоты',rarity:'Легендарный',color:'#bd82ff'}
};
let ugrWorldPets=[],ugrWorldCatalog=[],ugrWorldWallet=0,ugrWorldChannel=null,ugrWorldBusy=false;
let ugrWorldRoom={room_theme:'violet',floor_theme:'midnight',furniture:[]},ugrRoomSelected='bed';
const UGR_ROOM_ITEMS={
 bed:{emoji:'🛏️',label:'Кровать'},food_bowl:{emoji:'🥣',label:'Миска еды'},
 water_bowl:{emoji:'💧',label:'Вода'},ball:{emoji:'⚽',label:'Мяч'},
 plant:{emoji:'🪴',label:'Растение'},lamp:{emoji:'💡',label:'Лампа'},
 window:{emoji:'🌙',label:'Окно'},rug:{emoji:'🟣',label:'Ковёр'},
 bookshelf:{emoji:'📚',label:'Полка'},poster:{emoji:'🖼️',label:'Постер'},
 cactus:{emoji:'🌵',label:'Кактус'},moon_lamp:{emoji:'🌕',label:'Лунный свет'}
};
let ugrNeedsTicker=null;
function openUgrWorld(){
 if(!currentUser){toast('Сначала войди в аккаунт');return}
 $('modalTitle').textContent='🌌 UGR WORLD';
 $('modalBody').innerHTML='<div class="world-empty">Загружаем мир UGR…</div>';
 $('modal').classList.add('world-modal');$('modal').classList.remove('hidden');
 loadUgrWorld();if(ugrNeedsTicker)clearInterval(ugrNeedsTicker);ugrNeedsTicker=setInterval(()=>{if(!$('modal').classList.contains('hidden')&&$('modal').classList.contains('world-modal')){ugrSyncPetNeeds().then(renderUgrWorld)}},60000);
}
function closeModal(){
 $('modal').classList.add('hidden');$('modal').classList.remove('world-modal');
 if(ugrWorldChannel){sb.removeChannel(ugrWorldChannel);ugrWorldChannel=null;}
}
async function loadUgrWorld(){
 try{
  const [cat,pets]=await Promise.all([
   sb.from('ugr_pet_catalog').select('pet_key,display_name,rarity,description,base_stats').eq('active',true).order('sort_order'),
   sb.from('ugr_user_pets').select('*').order('created_at',{ascending:true})
  ]);
  if(cat.error)throw cat.error;if(pets.error)throw pets.error;
  ugrWorldCatalog=cat.data||[];ugrWorldPets=pets.data||[];
  await ugrSyncPetNeeds();
  renderUgrWorld();
  if(ugrWorldChannel)sb.removeChannel(ugrWorldChannel);
  ugrWorldChannel=sb.channel('ugr-world-user-'+currentUser.id)
   .on('postgres_changes',{event:'*',schema:'public',table:'ugr_user_pets',filter:'user_id=eq.'+currentUser.id},()=>refreshUgrWorldData())
   .subscribe();
 }catch(e){$('modalBody').innerHTML='<div class="world-empty">Не удалось загрузить UGR WORLD.<br><span class="world-muted">'+escapeHtml(e.message||'Ошибка базы данных')+'</span></div>'}
}
async function refreshUgrWorldData(){
 const {data:pets,error}=await sb.from('ugr_user_pets').select('*').order('created_at',{ascending:true});
 if(!error){ugrWorldPets=pets||[];await ugrSyncPetNeeds();renderUgrWorld()}
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

async function ugrSyncPetNeeds(){
 const active=ugrWorldPets.find(p=>p.is_active)||ugrWorldPets[0];if(!active)return;
 const {data,error}=await sb.rpc('ugr_update_pet_needs',{p_pet_id:active.id});
 if(!error&&data){const pet=data.pet||data;ugrWorldPets=ugrWorldPets.map(p=>p.id===active.id?pet:p)}
 else console.warn('UGR pet needs migration may be required:',error?.message);
}
function petState(p){if(p.energy<=15)return 'sleep';if(p.hunger<=20)return 'hungry';if(p.thirst<=20)return 'thirsty';if(p.mood>=75)return 'happy';return 'idle'}
function petHint(p){const st=petState(p);return ({sleep:'💤',hungry:'🍖',thirsty:'💧',happy:'💜',idle:'✨'})[st]}
function renderUgrWorld(){
 const active=ugrWorldPets.find(p=>p.is_active)||ugrWorldPets[0];
 let content=`<div class="world-hero"><div class="world-kicker">YOUR UNIVERSE · EST. UGR</div><div class="world-title">UGR WORLD</div><div class="world-sub">Твой маленький мир: заботься о питомце, играй и открывай награды.</div></div>`;
 const stat=(label,key)=>{const value=Math.max(0,Math.min(100,Number(active[key]??80)));return `<div class="world-stat"><div class="world-stat-head"><span>${label}</span><b>${value}%</b></div><div class="world-stat-bar"><div class="world-stat-fill ${value<25?'low':''}" style="width:${value}%"></div></div></div>`};
 if(active){const v=UGR_PET_VISUALS[active.pet_key]||{emoji:'🐾',name:active.pet_key};const state=petState(active);const bubble=petHint(active);content+=`<div class="world-section-title">ТВОЙ ПИТОМЕЦ</div><div class="world-pet-room"><div class="world-pet-avatar state-${state}"><span class="pet-sprite">${v.emoji}</span><span class="pet-status-bubble">${bubble}</span></div><div class="world-pet-details"><div class="world-pet-name" style="font-size:21px">${escapeHtml(active.nickname)}</div><div class="world-level">✦ ${v.name} · Уровень ${active.level} · ${active.xp} XP</div>${stat('🍖 Сытость','hunger')}${stat('💧 Вода','thirst')}${stat('⚡ Энергия','energy')}${stat('💜 Настроение','mood')}${stat('🫧 Чистота','cleanliness')}<div class="world-muted">${state==='sleep'?'Питомец очень устал и отдыхает.':'Питомец живёт своей жизнью и нуждается в заботе.'} Опыт до следующего уровня: ${100-(active.xp%100)} XP</div></div></div><div class="world-actions"><button class="world-action" onclick="ugrPetAction('feed')">🍖 Кормить</button><button class="world-action" onclick="ugrPetAction('water')">💧 Напоить</button><button class="world-action" onclick="ugrPetAction('play')">🎾 Играть</button><button class="world-action" onclick="ugrPetAction('pet')">💜 Гладить</button><button class="world-action" onclick="ugrPetAction('sleep')">🌙 Сон</button></div>`;
  if(ugrWorldPets.length>1)content+=`<div class="world-section-title">МОЯ КОЛЛЕКЦИЯ</div><div class="world-pet-grid">${ugrWorldPets.map(p=>{const pv=UGR_PET_VISUALS[p.pet_key]||{emoji:'🐾',rarity:p.rarity};return `<div class="world-pet-card ${p.id===active.id?'selected':''}"><div class="world-pet-emoji">${pv.emoji}</div><div class="world-pet-name">${escapeHtml(p.nickname)}</div><div class="world-rarity">${pv.rarity||p.rarity} · ур. ${p.level}</div><button class="smallbtn" style="width:100%;margin-top:10px" onclick="ugrSelectActivePet('${p.id}')" ${p.is_active?'disabled':''}>${p.is_active?'Активен':'Выбрать'}</button></div>`}).join('')}</div>`;
 }else{content+=`<div class="world-section-title">ВЫБЕРИ ПЕРВОГО ПИТОМЦА</div><div class="world-muted" style="margin-bottom:12px">Первый питомец бесплатный.</div><div class="world-pet-grid">${ugrWorldCatalog.map(c=>{const v=UGR_PET_VISUALS[c.pet_key]||{emoji:'🐾',rarity:c.rarity};return `<div class="world-pet-card"><div class="world-pet-emoji">${v.emoji}</div><div class="world-pet-name">${escapeHtml(c.display_name)}</div><div class="world-rarity">${v.rarity||c.rarity}</div><div class="world-pet-desc">${escapeHtml(c.description)}</div><button class="world-primary" style="width:100%;margin-top:9px" onclick="ugrChoosePet('${c.pet_key}')">Выбрать</button></div>`}).join('')}</div>`}
 content+=`<div class="world-section-title">МИР UGR</div><div class="world-pet-grid"><div class="world-pet-card"><div class="world-pet-name">🎮 UGR GAMES</div><div class="world-pet-desc">Игровые режимы и мини-игры</div></div><div class="world-pet-card"><div class="world-pet-name">🏆 НАГРАДЫ</div><div class="world-pet-desc">Достижения и прогресс питомца</div></div></div>`;
 $('modalBody').innerHTML=content;
}
async function ugrChoosePet(key){
 const nick=prompt('Как назовём питомца? (1–24 символа)');if(nick===null)return;
 if(!nick.trim()){toast('Введи имя питомца');return}
 await ugrWorldRpc('ugr_adopt_first_pet',{p_pet_key:key,p_nickname:nick.trim()},'Питомец присоединился к тебе!');
}
async function ugrSelectActivePet(id){await ugrWorldRpc('ugr_set_active_pet',{p_pet_id:id},'Питомец выбран')}
async function ugrPetAction(action){
 const p=ugrWorldPets.find(x=>x.is_active)||ugrWorldPets[0];if(!p)return;
 const names={feed:'Питомец ест 🍖',water:'Питомец пьёт воду 💧',play:'Питомец играет 🎾',pet:'Питомцу приятно 💜',sleep:'Питомец отдыхает 🌙'};
 await ugrWorldRpc('ugr_interact_with_pet',{p_pet_id:p.id,p_action:action},names[action]);
}
async function ugrWorldRpc(fn,args,success){
 if(ugrWorldBusy)return;ugrWorldBusy=true;
 try{
  const {data,error}=await sb.rpc(fn,args);if(error)throw error;
  toast(success);
  await refreshUgrWorldData();
  if(data?.coins_awarded)toast(success+' · получена награда');
 }catch(e){toast(e.message||'Не удалось выполнить действие')}finally{ugrWorldBusy=false}
}

async function signOut(){if(sb)await sb.auth.signOut();localStorage.removeItem('ugr_session_hint');location.reload()}
$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});
$('messageInput').addEventListener('input',e=>{e.target.style.height='42px';e.target.style.height=Math.min(e.target.scrollHeight,110)+'px';broadcastTyping(true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>broadcastTyping(false),1500)});
function syncAppViewport(){
 // visualViewport height can shrink when the mobile keyboard opens. Anchor app to its visible viewport.
 const vv=window.visualViewport;const h=vv?vv.height:window.innerHeight;const offset=vv?vv.offsetTop:0;
 document.documentElement.style.setProperty('--app-height',Math.max(240,h)+'px');document.documentElement.style.setProperty('--viewport-offset',offset+'px');
 if(activeChat)requestAnimationFrame(()=>{scrollMessages();$('messageInput').scrollIntoView({block:'nearest',behavior:'smooth'})});
}
window.addEventListener('resize',syncAppViewport);window.addEventListener('orientationchange',()=>setTimeout(syncAppViewport,250));
if(window.visualViewport){window.visualViewport.addEventListener('resize',syncAppViewport);window.visualViewport.addEventListener('scroll',syncAppViewport)}
$('messageInput').addEventListener('focus',()=>setTimeout(syncAppViewport,180));$('messageInput').addEventListener('blur',()=>broadcastTyping(false));
syncAppViewport();
initSupabase();


if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker:', err)));
}
