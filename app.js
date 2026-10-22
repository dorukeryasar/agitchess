/* AgitChess starter. Set SUPABASE_URL and SUPABASE_ANON_KEY below. Never put a service_role/secret key here. */
const SUPABASE_URL = "https://sbzkehwgcaomagvzhvoq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EPkyydgse1ZgFc-Be8lTkw_uDg40UMb";
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") && !SUPABASE_ANON_KEY.includes("PASTE_");
const $ = id => document.getElementById(id);
let db = null, user = null, profile = null;
const notice = (msg, type="") => { $("notice").textContent=msg; $("notice").className="notice "+type; };
function showView(name){document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id==="view-"+name));document.querySelectorAll("nav [data-view]").forEach(x=>x.classList.toggle("secondary",x.dataset.view===name));}
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
$("profileBtn").addEventListener("click",()=>{$("username").value=profile?.username||"";$("profileDialog").showModal()});
$("profileForm").addEventListener("submit", async e=>{if(e.submitter?.value!=="save")return;e.preventDefault();await saveProfile()});
async function init(){
 if(!configured){$("userLabel").textContent="Kurulum bekleniyor";notice("Supabase bağlantısı için app.js içindeki iki ayarı doldur. Adımlar README.txt dosyasında.","");return}
 try{
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  let {data:{session}}=await db.auth.getSession();
  if(!session){const r=await db.auth.signInAnonymously();if(r.error)throw r.error;session=r.data.session}
  user=session.user;
  await loadProfile();
  $("userLabel").textContent=profile?("@"+profile.username):"Profil oluştur";
  if(!profile){$("username").value="";$("profileDialog").showModal();notice("Misafir oturumun hazır. Bir kullanıcı adı seçerek profilini oluştur.","ok")}
  else notice("Supabase bağlantısı hazır. Hoş geldin, @"+profile.username+".","ok");
  $("adminNav").hidden=profile?.role!=="admin";
  await loadFriends(); await loadTournaments();
 }catch(e){console.error(e);notice("Bağlantı hatası: "+(e.message||e)+" — Supabase Auth ve SQL kurulumunu kontrol et.","error")}
}
async function loadProfile(){const {data,error}=await db.from("profiles").select("*").eq("id",user.id).maybeSingle();if(error)throw error;profile=data}
async function saveProfile(){
 if(!db||!user){notice("Önce Supabase bağlantısını ayarla.","error");return}
 const username=$("username").value.trim().toLowerCase();
 if(!/^[a-z0-9_]{3,24}$/.test(username)){notice("Kullanıcı adı 3–24 karakter olmalı; yalnızca harf, sayı ve alt çizgi kullan.","error");return}
 const {data,error}=await db.from("profiles").upsert({id:user.id,username},{onConflict:"id"}).select().single();
 if(error){notice("Profil kaydedilemedi: "+error.message,"error");return}
 profile=data;$("profileDialog").close();$("userLabel").textContent="@"+profile.username;$("adminNav").hidden=profile.role!=="admin";notice("Profil oluşturuldu: @"+profile.username,"ok");await loadFriends()
}
async function searchUsers(){
 if(!profile){notice("Önce profilini oluştur.","error");return}
 const q=$("friendSearch").value.trim().toLowerCase();if(q.length<3){$("searchResults").textContent="En az 3 karakter gir.";return}
 const {data,error}=await db.from("profiles").select("id,username").ilike("username",q).neq("id",user.id).limit(10);
 if(error){$("searchResults").textContent=error.message;return}
 const box=$("searchResults");box.replaceChildren();
 if(!data.length){box.textContent="Kullanıcı bulunamadı.";return}
 data.forEach(p=>{const row=document.createElement("div");row.className="row-item";const name=document.createElement("strong");name.textContent="@"+p.username;const btn=document.createElement("button");btn.textContent="İstek gönder";btn.onclick=()=>sendRequest(p.id,btn);row.append(name,btn);box.append(row)})
}
async function sendRequest(to,btn){btn.disabled=true;const {error}=await db.from("friend_requests").insert({sender_id:user.id,receiver_id:to});if(error){notice("İstek gönderilemedi: "+error.message,"error");btn.disabled=false}else{btn.textContent="Gönderildi";notice("Arkadaşlık isteği gönderildi.","ok")}}
async function loadFriends(){
 if(!db||!profile)return;
 const {data:incoming,error}=await db.from("friend_requests").select("id,sender_id,profiles!friend_requests_sender_id_fkey(username)").eq("receiver_id",user.id).eq("status","pending");
 $("incoming").replaceChildren();
 if(error){$("incoming").textContent="İstekler yüklenemedi: "+error.message}else if(!incoming.length){$("incoming").textContent="Bekleyen istek yok."}else incoming.forEach(r=>{const row=document.createElement("div");row.className="row-item";const name=document.createElement("span");name.textContent="@"+(r.profiles?.username||"kullanıcı");const btn=document.createElement("button");btn.textContent="Kabul et";btn.onclick=()=>acceptRequest(r);row.append(name,btn);$("incoming").append(row)});
 const {data:links,error:e2}=await db.from("friendships").select("*").or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
 $("friendList").replaceChildren();
 if(e2){$("friendList").textContent="Arkadaş listesi yüklenemedi: "+e2.message;return}
 if(!links.length){$("friendList").textContent="Henüz arkadaş eklemedin.";return}
 for(const f of links){const other=f.user1_id===user.id?f.user2_id:f.user1_id;const {data:p}=await db.from("profiles").select("username").eq("id",other).maybeSingle();const row=document.createElement("div");row.className="row-item";row.textContent="@"+(p?.username||"kullanıcı");$("friendList").append(row)}
}
async function acceptRequest(r){
 const {error}=await db.rpc("accept_friend_request",{request_id:r.id});
 if(error){notice("İstek kabul edilemedi: "+error.message,"error");return}
 notice("Arkadaş eklendi!","ok");await loadFriends()
}
$("searchUser").addEventListener("click",searchUsers);
$("createRoom").addEventListener("click",async()=>{
 if(!db||!profile){notice("Önce Supabase bağlantısını kur ve profil oluştur.","error");return}
 const {data,error}=await db.from("game_rooms").insert({white_player:user.id}).select("invite_code").single();
 if(error){notice("Oda oluşturulamadı: "+error.message,"error");return}
 const link=location.origin+location.pathname+"?room="+encodeURIComponent(data.invite_code);
 $("roomLink").textContent=link;$("roomPanel").hidden=false;notice("Davet odası oluşturuldu. Bağlantıyı arkadaşına gönder.","ok")
});
$("copyRoom").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("roomLink").textContent);notice("Davet bağlantısı kopyalandı.","ok")}catch{notice("Bağlantıyı metinden seçip kopyalayabilirsin.")}});
async function loadTournaments(){
 if(!db)return;const {data,error}=await db.from("tournaments").select("id,name,status,starts_at").order("created_at",{ascending:false}).limit(30);const box=$("tournamentList");box.replaceChildren();
 if(error){box.textContent="Turnuvalar yüklenemedi: "+error.message;return}
 if(!data.length){box.textContent="Henüz turnuva yok.";return}
 data.forEach(t=>{const row=document.createElement("div");row.className="row-item";const info=document.createElement("span");info.textContent=t.name+" · "+t.status+(t.starts_at?" · "+new Date(t.starts_at).toLocaleString("tr-TR"):"");const btn=document.createElement("button");btn.textContent="Katıl";btn.onclick=async()=>{const {error}=await db.from("tournament_players").insert({tournament_id:t.id,player_id:user.id});notice(error?"Katılım başarısız: "+error.message:"Turnuvaya katıldın.",""+(error?"error":"ok"))};row.append(info,btn);box.append(row)})
}
$("loadUsers").addEventListener("click",async()=>{
 if(profile?.role!=="admin"){notice("Bu işlem için admin yetkisi gerekiyor.","error");return}
 const {data,error}=await db.rpc("admin_list_profiles");const box=$("userTable");box.replaceChildren();
 if(error){notice("Kullanıcılar yüklenemedi: "+error.message,"error");return}
 data.forEach(p=>{const row=document.createElement("div");row.className="row-item";const name=document.createElement("span");name.textContent="@"+p.username+" · "+(p.is_banned?"Banlı":"Aktif")+" · "+p.role;const btn=document.createElement("button");btn.className="danger";btn.textContent=p.is_banned?"Banı kaldır":"Banla";btn.onclick=async()=>{const {error}=await db.rpc("admin_set_ban",{target_user:p.id,ban_value:!p.is_banned});notice(error?"İşlem başarısız: "+error.message:"Kullanıcı durumu güncellendi.",""+(error?"error":"ok"));$("loadUsers").click()};row.append(name,btn);box.append(row)})
});
$("localDemo").addEventListener("click",()=>{$("demoPanel").hidden=false;renderDemoBoard();$("demoPanel").scrollIntoView({behavior:"smooth",block:"nearest"})});
function renderDemoBoard(){const pieces=["♜","♞","♝","♛","♚","♝","♞","♜","♟","♟","♟","♟","♟","♟","♟","♟","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","♙","♙","♙","♙","♙","♙","♙","♙","♖","♘","♗","♕","♔","♗","♘","♖"];const board=$("board");board.replaceChildren();pieces.forEach((p,i)=>{const s=document.createElement("div");s.className="square "+(((i>>3)+(i&7))%2?"dark":"light");s.textContent=p;board.append(s)})}
const room=new URLSearchParams(location.search).get("room");if(room){$("roomPanel").hidden=false;$("roomLink").textContent=location.href;notice("Davet bağlantısı açıldı. Katılım ve gerçek zamanlı hamle aktarımı için oda katılma akışı henüz eklenmeli.")}
init();