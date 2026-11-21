
const SUPABASE_URL='https://wpdltxncbzcuwmidtzys.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_PNACWSzOfHMNLFB-1Lbj7g_kqLVvKnM';
let sb=null, currentUser=null, profile=null, chats=[], activeChat=null, channel=null, authMode='login', notificationChannel=null, unreadNotifications=0, totalXp=0, selectedAvatarEmoji='🙂', selectedAvatarPhoto=false, selectedCurtainColor='#5a3b8d', developerWelcomeExpanded=false;
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
 await loadProfile();await loadChats();await claimDailyXp();await loadUnreadNotifications();subscribeGlobalMessages();subscribeNotifications();showDeveloperWelcomeIfNeeded();
 sb.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){location.reload()}});
}
async function loadProfile(){
 const {data,error}=await sb.from('profiles').select('*').eq('id',currentUser.id).maybeSingle();
 if(error)throw error;profile=data;
 if(!profile){toast('Профиль не найден. Проверь SQL-настройку в Supabase.');return}
 $('myName').textContent='@'+profile.username;$('myEmail').textContent=currentUser.email||'';renderAvatar($('myAvatar'),profile);
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
 // The notification table is populated transactionally by a database trigger.
 globalChannel=sb.channel('ugr-global-messages-'+currentUser.id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},async payload=>{
   const m=payload.new;if(m.sender_id===currentUser.id)return;
   const c=chats.find(x=>x.id===m.conversation_id);if(c){c.last=m;renderChats();}
  }).subscribe();
}
function subscribeNotifications(){
 if(notificationChannel)sb.removeChannel(notificationChannel);
 notificationChannel=sb.channel('ugr-notifications-'+currentUser.id)
  .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'recipient_id=eq.'+currentUser.id},payload=>{
   unreadNotifications++;updateNotificationBadge();
   const note=payload.new;
   if(!activeChat||activeChat.id!==note.conversation_id||!$('app').classList.contains('show-chat'))toast('🔔 '+(note.message||'Новое уведомление'));
  }).subscribe();
}
function updateNotificationBadge(){const b=$('notificationBadge');b.textContent=unreadNotifications>99?'99+':unreadNotifications;b.classList.toggle('hidden',unreadNotifications===0)}
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
  const {data:cards}=await sb.rpc('get_profile_cards',{target_user_ids:[other.user_id]});const {data:details}=await sb.rpc('get_public_profile_details',{target_user_id:other.user_id});const detail=Array.isArray(details)?details[0]:details;const p=cards?.[0]?{...cards[0],...(detail||{}),id:other.user_id}:null;
  const {data:last}=await sb.from('messages').select('body,created_at').eq('conversation_id',id).order('created_at',{ascending:false}).limit(1);
  if(p)chats.push({id,other:p,last:last?.[0]||null});
 }
 chats.sort((a,b)=>new Date(b.last?.created_at||0)-new Date(a.last?.created_at||0));renderChats();
}
function renderChats(){
 const q=$('searchChats').value.toLowerCase();$('chatList').innerHTML='';
 chats.filter(c=>('@'+c.other.username).toLowerCase().includes(q)).forEach(c=>{
  const el=document.createElement('div');el.className='chat'+(activeChat?.id===c.id?' active':'');
  const av=c.other.avatar_url?document.createElement('img'):document.createElement('div');av.className=c.other.avatar_url?'profilepic':'avatar';renderAvatar(av,c.other);if(c.other.avatar_url)av.src=c.other.avatar_url;
  const info=document.createElement('div');info.className='chat-info';
  const top=document.createElement('div');top.className='chat-top';const n=document.createElement('span');n.className='chat-name';n.textContent=c.other.profile_private?'Закрытый профиль':'@'+(c.other.username||'пользователь');
  const t=document.createElement('span');t.className='time';t.textContent=c.last?new Date(c.last.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
  const p=document.createElement('div');p.className='preview';p.textContent=c.last?.body||'Начните переписку';
  top.append(n,t);info.append(top,p);el.append(av,info);el.onclick=()=>openChat(c);$('chatList').append(el);
 });
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
 if(activeChat&&$('messageInput'))saveDraft(activeChat.id,$('messageInput').value);
 if(channel){await sb.removeChannel(channel);channel=null}
 activeChat=c;$('headName').textContent='@'+(c.other.username||'пользователь');$('headStatus').textContent='Личная переписка · нажми, чтобы открыть профиль';renderAvatar($('headAvatar'),c.other);$('headName').onclick=()=>viewUserProfile(c.other.id||c.other.user_id);$('headAvatar').onclick=()=>viewUserProfile(c.other.id||c.other.user_id);$('headName').style.cursor='pointer';$('headAvatar').style.cursor='pointer';
 $('messageInput').disabled=false;$('send').disabled=false;$('messages').innerHTML='<div class="empty">Загружаем сообщения…</div>';$('app').classList.add('show-chat');renderChats();
 // Subscribe first so messages arriving while history loads are not missed. appendMessage deduplicates IDs.
 channel=sb.channel('ugr-chat-'+c.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'conversation_id=eq.'+c.id},payload=>{if(payload.new.sender_id!==currentUser.id){appendMessage(payload.new);markIncomingRead(c.id)}}).on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages',filter:'conversation_id=eq.'+c.id},payload=>updateReadMark(payload.new)).subscribe();
 await loadMessages(c.id);$('messageInput').value=loadDraft(c.id);$('messageInput').style.height='42px';$('messageInput').style.height=Math.min($('messageInput').scrollHeight,110)+'px';await markIncomingRead(c.id);
}
async function loadMessages(id){
 const {data,error}=await sb.from('messages').select('id,conversation_id,sender_id,body,created_at,read_at').eq('conversation_id',id).order('created_at',{ascending:true}).limit(500);
 if(error){toast(error.message);return}
 $('messages').innerHTML='';(data||[]).forEach(appendMessage);scrollMessages();
}
function appendMessage(m){
 if(!$('messages') || !m?.id || document.querySelector(`[data-id="${m.id}"]`)) return;
 const b=document.createElement('div');b.className='bubble'+(m.sender_id===currentUser.id?' mine':'');b.dataset.id=m.id;
 const body=document.createElement('div');body.textContent=m.body;const tm=document.createElement('div');tm.className='msg-time';tm.textContent=new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
 if(m.sender_id===currentUser.id){const mark=document.createElement('span');mark.className='readmark';mark.dataset.read='';mark.textContent=m.read_at?'✓✓':'✓';tm.append(mark)}b.append(body,tm);
 const tools=document.createElement('div');tools.className='msg-tools';const react=document.createElement('button');react.textContent='☺';react.title='Реакция';react.onclick=()=>addReaction(m.id);const save=document.createElement('button');save.textContent=isSaved(m.id)?'★':'☆';save.title='Сохранить';save.onclick=()=>toggleSaved(m,save);tools.append(react,save);
 if(m.sender_id===currentUser.id){const edit=document.createElement('button');edit.textContent='✎';edit.title='Редактировать';edit.onclick=()=>editOwnMessage(m);const del=document.createElement('button');del.textContent='×';del.title='Удалить';del.onclick=()=>deleteOwnMessage(m);tools.append(edit,del)}
 b.append(tools);renderReactions(b,m.id);$('messages').append(b);scrollMessages();
}
function scrollMessages(){$('messages').scrollTop=$('messages').scrollHeight}
async function markIncomingRead(conversationId){const {error}=await sb.from('messages').update({read_at:new Date().toISOString()}).eq('conversation_id',conversationId).neq('sender_id',currentUser.id).is('read_at',null);if(error)console.warn('read receipt',error)}
function updateReadMark(m){if(!m.read_at)return;const node=document.querySelector('[data-id=\"'+m.id+'\"] [data-read]');if(node)node.textContent='✓✓'}
async function sendMessage(){
 const input=$('messageInput'),body=input.value.trim();if(!body||!activeChat)return;
 input.value='';input.style.height='42px';saveDraft(activeChat.id,'');
 const {data,error}=await sb.from('messages').insert({conversation_id:activeChat.id,sender_id:currentUser.id,body}).select().single();
 if(error){input.value=body;toast(error.message);return}
 appendMessage(data);const c=chats.find(x=>x.id===activeChat.id);if(c){c.last=data;renderChats()}
}
function backToChats(){$('app').classList.remove('show-chat')}
function closeModal(){$('modal').classList.add('hidden')}
async function openProfile(){
 $('modalTitle').textContent='Мой профиль';
 $('modalBody').innerHTML='<div class="profile-preview opened" id="curtainPreview"><div class="profile-preview-main"><div class="profile-preview-avatar" id="previewAvatar">U</div><div><strong id="previewNick">@username</strong><div class="muted">Так профиль видят другие</div></div></div><div class="curtain left"></div><div class="curtain right"></div></div><div class="row" style="gap:8px"><button class="smallbtn" id="curtainButton" onclick="toggleCurtains()">Шторки</button><label class="smallbtn" style="display:flex;align-items:center;gap:7px">Цвет <input id="curtainColor" type="color" style="width:34px;height:25px;padding:0;border:0;background:transparent" value="#5a3b8d" onchange="previewCurtainColor(this.value)"></label></div><div class="muted">Выбери эмодзи для аватарки</div><div class="emoji-picker" id="emojiPicker"></div><div class="muted">Или загрузи фото (до 5 МБ)</div><input id="avatarFile" class="field" type="file" accept="image/*"><label class="muted">Уникальный ник</label><input id="profileUsername" class="field" maxlength="20"><label class="muted">Отображаемое имя</label><input id="displayName" class="field" maxlength="40"><label class="muted">О себе</label><textarea id="bio" class="field" maxlength="240" rows="3" placeholder="Расскажи немного о себе"></textarea><button class="primary" onclick="saveProfile()">Сохранить</button><button class="link" onclick="signOut()">Выйти из аккаунта</button>';
 $('modal').classList.remove('hidden');$('profileUsername').value=profile?.username||'';$('displayName').value=profile?.display_name||'';$('bio').value=profile?.bio||'';
 selectedAvatarEmoji=profile?.avatar_emoji||'🙂';selectedAvatarPhoto=!!profile?.avatar_url;selectedCurtainColor=safeColor(profile?.curtain_color);$('curtainColor').value=selectedCurtainColor;$('curtainPreview').style.setProperty('--curtain-base',selectedCurtainColor);
 $('previewNick').textContent='@'+(profile?.username||'username');const av=$('previewAvatar');renderAvatar(av,profile);av.classList.toggle('emoji-avatar',!profile?.avatar_url);$('avatarFile').onchange=()=>{if($('avatarFile').files?.[0])selectedAvatarPhoto=true};buildEmojiPicker();updateCurtainButton();
}
const AVATAR_EMOJIS=['🙂','😎','😈','👻','🐸','🐱','🐼','🦊','🐧','🐥','🦋','🐉','💀','🤡','🤖','👑','🔥','⭐','🌙','❤️','💜','⚡','🍀','🎭'];
function buildEmojiPicker(){const box=$('emojiPicker');box.innerHTML='';AVATAR_EMOJIS.forEach(e=>{const b=document.createElement('button');b.type='button';b.className='emoji-choice'+(e===selectedAvatarEmoji?' selected':'');b.textContent=e;b.onclick=()=>{selectedAvatarEmoji=e;selectedAvatarPhoto=false;$('avatarFile').value='';$('previewAvatar').innerHTML='';$('previewAvatar').textContent=e;$('previewAvatar').classList.add('emoji-avatar');buildEmojiPicker()};box.append(b)})}
function previewCurtainColor(color){selectedCurtainColor=safeColor(color);$('curtainPreview').style.setProperty('--curtain-base',selectedCurtainColor)}
function updateCurtainButton(){const closed=!!profile?.profile_private;$('curtainButton').textContent=closed?'Шторки закрыты':'Шторки открыты';$('curtainPreview').classList.toggle('closed',closed);$('curtainPreview').classList.toggle('opened',!closed)}
async function viewUserProfile(userId){
 if(!userId){toast('Не удалось определить пользователя');return}
 try{const {data,error}=await sb.rpc('get_public_profile_details',{target_user_id:userId});if(error)throw error;const p=Array.isArray(data)?data[0]:data;if(!p){toast('Профиль недоступен');return}
 $('modalTitle').textContent='Профиль пользователя';const closed=!!p.profile_private;
 $('modalBody').innerHTML='<div class="profile-preview '+(closed?'closed':'opened')+'" id="publicCurtainPreview"><div class="profile-preview-main"><div class="profile-preview-avatar" id="publicPreviewAvatar"></div><div><strong id="publicPreviewNick"></strong><div class="muted" id="publicDisplayName"></div></div></div><div class="curtain left"></div><div class="curtain right"></div></div><div class="muted" id="publicBio" style="white-space:pre-wrap"></div><div class="profile-actions"><button class="primary" id="publicWriteButton">Написать</button></div>';
 $('modal').classList.remove('hidden');$('publicCurtainPreview').style.setProperty('--curtain-base',safeColor(p.curtain_color));$('publicPreviewNick').textContent='@'+(p.username||'пользователь');if(p.username==='ugr_creator')$('publicPreviewNick').insertAdjacentHTML('afterend',' <span class=\"verified-badge\" title=\"Разработчик UGR\">✓</span><div class=\"developer-role\">Разработчик UGR</div>');$('publicDisplayName').textContent=p.display_name||'';$('publicBio').textContent=p.bio||'';renderAvatar($('publicPreviewAvatar'),p);$('publicPreviewAvatar').classList.toggle('emoji-avatar',!p.avatar_url);$('publicWriteButton').onclick=()=>startChat({id:userId,...p});
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
async function showDeveloperWelcomeIfNeeded(){
 try{const {data,error}=await sb.rpc('claim_developer_welcome');if(error){console.warn('Приветствие разработчика пока не настроено:',error.message);return}if(!data)return;
 const box=$('developerWelcome');box.classList.remove('hidden');box.classList.add('collapsed');box.innerHTML='<button class="dev-open" onclick="toggleDeveloperWelcome()" aria-label="Приветствие разработчика">✉️</button><div class="dev-content hidden"><strong>Сообщение от разработчика</strong><p>Привет! Это я, разработчик этого приложения — Никита. Можешь написать мне, если появятся вопросы или предложения!</p><div class="dev-actions"><button class="smallbtn" onclick="openDeveloperProfile()">Написать мне</button><button class="smallbtn" onclick="toggleDeveloperWelcome()">Свернуть</button></div></div>';
 }catch(e){console.warn('Developer welcome:',e)}
}
function toggleDeveloperWelcome(){const box=$('developerWelcome');const collapsed=box.classList.toggle('collapsed');const content=box.querySelector('.dev-content');if(content)content.classList.toggle('hidden',collapsed);const opener=box.querySelector('.dev-open');if(opener)opener.classList.toggle('hidden',!collapsed)}
async function openDeveloperProfile(){await viewUserProfileByUsername('ugr_creator')}
async function openDeveloperChat(){try{const {data,error}=await sb.rpc('search_profiles',{search_term:'ugr_creator'});if(error)throw error;const p=(data||[]).find(x=>x.username==='ugr_creator');if(!p){toast('Профиль разработчика пока не найден');return}await startChat(p)}catch(e){toast(e.message||'Не удалось открыть чат с разработчиком')}}
async function viewUserProfileByUsername(username){try{const {data,error}=await sb.rpc('search_profiles',{search_term:username});if(error)throw error;const p=(data||[]).find(x=>x.username===username);if(!p){toast('Профиль @'+username+' пока не найден');return}await viewUserProfile(p.id)}catch(e){toast(e.message||'Не удалось открыть профиль разработчика')}}
async function signOut(){if(sb)await sb.auth.signOut();localStorage.removeItem('ugr_session_hint');location.reload()}
$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}});
$('messageInput').addEventListener('input',e=>{e.target.style.height='42px';e.target.style.height=Math.min(e.target.scrollHeight,110)+'px';if(activeChat)saveDraft(activeChat.id,e.target.value)});
function syncAppViewport(){
 const h=window.visualViewport?.height||window.innerHeight;
 document.documentElement.style.setProperty('--app-height',Math.max(240,h)+'px');
 if(activeChat)requestAnimationFrame(scrollMessages);
}
window.addEventListener('resize',syncAppViewport);
if(window.visualViewport){window.visualViewport.addEventListener('resize',syncAppViewport)}
$('messageInput').addEventListener('focus',()=>setTimeout(()=>{syncAppViewport();scrollMessages()},180));
syncAppViewport();
initSupabase();
// UGR 2.0 local features: per-chat drafts, bookmarks, message reactions and search.
const UGR_LOCAL_KEY='ugr2_local_'+(currentUser?.id||'guest');
function localData(){try{return JSON.parse(localStorage.getItem('ugr2_local_'+(currentUser?.id||'guest'))||'{}')}catch{return {}}}
function setLocalData(d){localStorage.setItem('ugr2_local_'+(currentUser?.id||'guest'),JSON.stringify(d))}
function saveDraft(chatId,value){const d=localData();d.drafts=d.drafts||{};d.drafts[chatId]=value;setLocalData(d)}
function loadDraft(chatId){return localData().drafts?.[chatId]||''}
function savedMessages(){return localData().saved||[]}
function isSaved(id){return savedMessages().some(x=>x.id===id)}
function toggleSaved(m,btn){const d=localData();d.saved=d.saved||[];const i=d.saved.findIndex(x=>x.id===m.id);if(i>=0)d.saved.splice(i,1);else d.saved.unshift({id:m.id,conversation_id:m.conversation_id,sender_id:m.sender_id,body:m.body,created_at:m.created_at});setLocalData(d);btn.textContent=isSaved(m.id)?'★':'☆';toast(isSaved(m.id)?'Сохранено':'Удалено из сохранённого')}
function openSavedMessages(){ $('modalTitle').textContent='★ Сохранённые сообщения';const items=savedMessages();$('modalBody').innerHTML=items.length?items.map(x=>'<div class="message-search-result" data-saved="'+x.id+'"><div class="result-meta">'+new Date(x.created_at).toLocaleString('ru-RU')+'</div><div class="result-text"></div><button class="smallbtn unsave" style="margin-top:8px">Убрать</button></div>').join(''):'<div class="muted">Пока ничего не сохранено. Нажимай ☆ под сообщениями.</div>';$('modal').classList.remove('hidden');const rows=[...$('modalBody').querySelectorAll('[data-saved]')];rows.forEach((r,i)=>{r.querySelector('.result-text').textContent=items[i].body;r.onclick=e=>{if(e.target.classList.contains('unsave')){const d=localData();d.saved=(d.saved||[]).filter(x=>x.id!==items[i].id);setLocalData(d);openSavedMessages();return}const c=chats.find(x=>x.id===items[i].conversation_id);if(c){closeModal();openChat(c).then(()=>setTimeout(()=>highlightMessage(items[i].id),250))}else toast('Чат пока не найден')}})}
function highlightMessage(id){const node=document.querySelector('[data-id="'+id+'"]');if(!node)return;node.classList.add('search-hit');node.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>node.classList.remove('search-hit'),2500)}
async function searchMessagesAll(){ $('modalTitle').textContent='⌕ Поиск сообщений';$('modalBody').innerHTML='<input id="messageSearchQuery" class="field" placeholder="Искать в сообщениях…"><div id="messageSearchResults" class="form"></div>';$('modal').classList.remove('hidden');$('messageSearchQuery').focus();let debounce; $('messageSearchQuery').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>runMessageSearch($('messageSearchQuery').value),250)} }
async function runMessageSearch(q){const out=$('messageSearchResults');if(!out)return;const query=q.trim();out.innerHTML='';if(query.length<2){out.textContent='Введи хотя бы 2 символа';return}out.textContent='Ищем…';let results=[];for(const c of chats){const {data,error}=await sb.from('messages').select('id,conversation_id,sender_id,body,created_at').eq('conversation_id',c.id).ilike('body','%'+query.replace(/[%,_]/g,'\\$&')+'%').order('created_at',{ascending:false}).limit(20);if(!error)results.push(...(data||[]).map(m=>({...m,username:c.other.username})));}results.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));out.innerHTML='';if(!results.length){out.textContent='Ничего не найдено';return}results.slice(0,80).forEach(m=>{const row=document.createElement('div');row.className='message-search-result';const meta=document.createElement('div');meta.className='result-meta';meta.textContent='@'+m.username+' · '+new Date(m.created_at).toLocaleString('ru-RU');const text=document.createElement('div');text.className='result-text';text.textContent=m.body;row.append(meta,text);row.onclick=()=>{const c=chats.find(x=>x.id===m.conversation_id);if(c){closeModal();openChat(c).then(()=>setTimeout(()=>highlightMessage(m.id),250))}};out.append(row)})}
function renderReactions(node,id){const d=localData(),r=d.reactions?.[id];if(!r)return;const wrap=document.createElement('div');wrap.className='reactions';Object.entries(r).forEach(([emoji,count])=>{if(count>0){const p=document.createElement('span');p.className='reaction-pill';p.textContent=emoji+' '+count;wrap.append(p)}});node.append(wrap)}
function addReaction(id){const choices=['👍','❤️','😂','😮','😢','🔥','👎'];const choice=prompt('Выбери реакцию: '+choices.join(' '));if(!choices.includes(choice))return;const d=localData();d.reactions=d.reactions||{};d.reactions[id]=d.reactions[id]||{};d.reactions[id][choice]=(d.reactions[id][choice]||0)+1;setLocalData(d);const node=document.querySelector('[data-id="'+id+'"]');if(node){node.querySelector('.reactions')?.remove();renderReactions(node,id)} }
async function editOwnMessage(m){const next=prompt('Изменить сообщение:',m.body);if(next===null||!next.trim()||next.trim()===m.body)return;const {data,error}=await sb.from('messages').update({body:next.trim()}).eq('id',m.id).eq('sender_id',currentUser.id).select().single();if(error){toast('Редактирование не удалось: '+error.message);return}const node=document.querySelector('[data-id="'+m.id+'"]');if(node){node.querySelector(':scope > div').textContent=data.body;node.dataset.edited='true'}toast('Сообщение изменено')}
async function deleteOwnMessage(m){if(!confirm('Удалить это сообщение?'))return;const {error}=await sb.from('messages').delete().eq('id',m.id).eq('sender_id',currentUser.id);if(error){toast('Удаление не удалось: '+error.message);return}document.querySelector('[data-id="'+m.id+'"]').remove();toast('Сообщение удалено')}


if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker:', err)));
}
