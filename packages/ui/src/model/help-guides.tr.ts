import type { HelpGuidesMessages } from './help-guides.ts';

export const tr: HelpGuidesMessages = {
  "guides": {
    "import": {
      "title": "Video oluştur ve medya içe aktar",
      "short": "Oluştur ve içe aktar",
      "summary": "Space içinde video oluşturun, sonra medyayı medya kitaplığına ve zaman çizelgesine ekleyin.",
      "keywords": "yeni oluştur dosya medya medya kitaplığı içe aktar sürükle bırak ses görsel video",
      "steps": [
        [
          "Video oluştur",
          "Solda “Space” açın, “Yeni” → “Yeni boş video” tıklayın, projesini seçin, sonra Home içinde en boy oranını seçip “Boş video oluştur” tıklayın. Video veya ses dosyanız varsa “Dosyadan yeni video” tıklayın; Home bu dosyayla açılır ve altyazı ekleme ile yazıya döküp çevirme arasında seçim sunar. Henüz projeniz yoksa önce Home içinde proje klasörü açın veya oturumda ajandan oluşturmasını isteyin."
        ],
        [
          "Medyayı medya kitaplığına içe aktar",
          "Düzenleyicinin sağ panelinde “Video”, “Ses” veya “Görseller” açın, “İçe aktar” tıklayıp dosya seçin veya kesikli kutuya sürükleyin. İçe aktarma yalnızca dosyaları video klasörüne kopyalar; özgün dosyalara dokunulmaz."
        ],
        [
          "Zaman çizelgesine yerleştir",
          "Medya satırının sağındaki “+” düğmesine tıklayıp oynatma kafasına yerleştirin. Medyayı zaman çizelgesindeki satıra veya bilgisayarınızdaki dosyayı doğrudan zaman çizelgesine de sürükleyebilirsiniz."
        ]
      ],
      "tip": "İçe aktarma ve zaman çizelgesine koyma iki adımdır: yeni medya kitaplıkta durur, görüntüde henüz görünmez.",
      "cta": "Dosyadan yeni video"
    },
    "subtitle": {
      "title": "Altyazı ekle ve satır satır düzelt",
      "short": "Altyazı ekle",
      "summary": "Altyazı dosyası içe aktarın veya ajanla yazıya dökün, sonra dinleyip altyazıları doğrulayın.",
      "keywords": "yazıya dök döküm tanıma srt vtt webvtt ass yazım böl birleştir bul değiştir altyazı",
      "steps": [
        [
          "Önce altyazıları al",
          "Sağda “Altyazı” açın. Videoda medya varsa “Altyazı oluştur” tıklayıp cihazdaki konuşma modeli veya bağlı bulut hizmetiyle yazıya dökün; bitince altyazılar görüntüye otomatik eklenir. Düğmenin altındaki daraltılmış “Yazıya dökme ayarları” dil, konuşma modeli ve tanıma ipuçlarını değiştirir. Hazır altyazı dosyanız varsa “Altyazı dosyası içe aktar” tıklayın; SRT, WebVTT ve ASS desteklenir. Konuşmacıları işaretlemek için “Araçlar › Yazıya dök” kullanın: konuşma modelinin altında “Diğer seçenekler” açıp “Konuşmacıları belirle” seçeneğini açın. MOSS Transcribe konuşmacıları kendisi ayırt eder, bu yüzden açık kalır; diğer cihaz modelleri “Konuşmacı ayrımı” gerektirir, ilk açışta indirme istenir."
        ],
        [
          "Satıra tıkla ve düzenle",
          "Satırın zamanına tıklayınca oynatma kafası oraya gider; metne tıklayınca düzenlenir. Enter iki satıra böler, satır başında Backspace önceki satırla birleştirir, Shift+Enter satır içinde yeni satır ekler, Esc düzenlemeyi iptal eder."
        ],
        [
          "Yeniden dinle, sonra her yerde düzelt",
          "Metin kutusundan çıktıktan sonra Space tuşuyla oynatıp metni konuşmayla karşılaştırın. Panel üstünde okuma hızını aşan satır sayısı görünür. Aynı hatayı birçok yerde düzeltmek için bul ve değiştir kullanın (⌘F / Ctrl+F)."
        ]
      ],
      "tip": "Yalnızca “Altyazı oluştur” ile başlayan yazıya dökme işlemleri görüntüye otomatik eklenir. Ajan oturumda yazıya dökünce önce döküm olarak kaydedilir; “Altyazı” kısmına dönüp “Altyazı oluştur” tıklayın. Birden fazla altyazı izi varsa “Altyazı” başlığındaki menüden düzenlenecek izi seçin.",
      "cta": "Altyazıları aç"
    },
    "translate": {
      "title": "İki dilli altyazı için çeviri ekle",
      "short": "Çeviri ve iki dil",
      "summary": "Altyazı panelinde hedef dil ve metin modeli seçin; çeviri yeni altyazı izi olarak görüntüye eklenir.",
      "keywords": "çevir çeviri İngilizce Çince iki dil kaynak yan yana sözlük metin modeli",
      "steps": [
        [
          "Önce kaynağı düzelt",
          "Çeviri döküm metnini cümle cümle işler. Sonraki düzenlemeleri azaltmak için önce adları, terimleri ve belirgin tanıma hatalarını düzeltin. Çevrilen altyazılar yazıya dökmeden gelmeli: içe aktarılan altyazı dosyalarında sözcük zamanları yoktur, doğrudan çevrilemez."
        ],
        [
          "İz çubuğunda “+ … diline çevir” tıkla",
          "Sağda “Altyazı” açın, iz çubuğunda “+ … diline çevir” tıklayın, hedef dil ve metin modeli seçin; gerekirse stil ipucu ekleyin veya sözlük işaretleyin, sonra alttaki başlat düğmesine tıklayın. Henüz metin modeli yoksa önce “Modeller › Metin oluşturma” kısmında hizmet bağlayın; çevrimiçi modeller token başına ücretlendirilir."
        ],
        [
          "Çeviriyi denetle ve iki dilli düzeni ayarla",
          "Bitince çeviri görüntüye otomatik eklenir, sonuç kartıyla tek tıkla geri alınabilir. “Liste” içinde “Özgün + çeviri” seçip satır satır karşılaştırın; çevrilmiş satıra tıklayıp yeniden yazın. Altyazı seçince “Altyazı özellikleri” içindeki “İki dilli” kısmı üstteki satırı ve aralarındaki uzaklığı ayarlar."
        ]
      ],
      "tip": "Yalnızca çeviriyi mi göstermek istiyorsunuz? Başlamadan önce “İki dili göster” kapatın veya iz çubuğunda kaynağın “×” düğmesine tıklayıp görüntüden çıkarın; kaynak silinmez. Kaynağı düzenleyince etkilenen çeviriler “Güncel değil” işaretlenir; yeniden yazmak işareti kaldırır. Masaüstü uygulamasında uyarıdaki “Eski çevirileri güncelle” tıklayın veya oturumda /refresh yazıp ajanla bu satırları yeniden çevirin.",
      "cta": "Altyazıları aç"
    },
    "export": {
      "title": "Video, altyazı veya döküm dışa aktar",
      "short": "Dışa aktar",
      "summary": "İhtiyacınıza göre teslimat seçin; video ve seste birkaç bölüm veya parçayı da dışa aktarabilirsiniz.",
      "keywords": "dışa aktar kaydet indir mp4 wav mp3 m4a srt vtt ass json markdown döküm bölüm parça ses yüksekliği proje dosyası premiere davinci resolve taşınabilir paket",
      "steps": [
        [
          "Video çubuğunda “Dışa aktar” tıkla",
          "Düzenleyicinin video çubuğunda sağdaki “Dışa aktar” tıklayın. Beş teslimatın ayrı sayfası vardır: Video (MP4), Ses (WAV, MP3 veya M4A), Altyazı (SRT, VTT, ASS veya JSON), Döküm (Markdown veya düz metin), Proje dosyası (Premiere Pro ve DaVinci Resolve için XML veya BaoCut taşınabilir paketi)."
        ],
        [
          "Aralık seç ve ayarları onayla",
          "Video ve seste tüm video, bölüme göre, parçaya göre veya özel başlangıç ve bitiş dışa aktarılır; altyazı, döküm ve proje dosyaları tüm sekansı dışa aktarır. Video sayfasında çözünürlük, dosya boyutu ve altyazıların görüntüye gömülmesini de onaylayın; gerekirse ses yüksekliği normalleştirmesini açın. Altyazı sayfasında iki izi işaretleyip tek iki dilli altyazı dosyasında birleştirin."
        ],
        [
          "Dışa aktarmayı başlat ve bitmesini bekle",
          "Dosyalar varsayılan olarak projenin exports/ klasörüne kaydedilir; isterseniz önce “Konum seç” tıklayın. Dışa aktarılırken pencereyi kapatıp çalışmaya devam edebilirsiniz; ilerleme “Dışa aktar” düğmesinde veya “Arka plan görevleri” kısmında görünür. Bitince “Klasörde göster” tıklayıp dosyayı bulun; başarısızsa pencere nedeni ve sonraki adımı açıklar."
        ]
      ],
      "tip": "Altyazı dosyası ve altyazılı video farklı teslimatlardır: ilki başka yazılıma yüklenir, ikincisi doğrudan oynatılıp paylaşılır."
    },
    "workspace": {
      "title": "Düzenleyiciyi tanıyın",
      "short": null,
      "summary": "Sonucu önizlemede görün, anları zaman çizelgesinde bulun ve içeriği sağ panelde değiştirin.",
      "keywords": "sahne tuval önizleme zaman çizelgesi panel denetçi özellikler iz oynatma bulamıyorum",
      "steps": [
        [
          "Orta: önizleme",
          "Oynatma kafasındaki görüntüyü gösterir; üstünde video boyutu ve kare hızı vardır. Alttaki oynatma kontrolleri oynatma, kare kare ilerleme, geri alma, yineleme ve oynatma kafasında bölme sunar."
        ],
        [
          "Alt: zaman çizelgesi",
          "Zaman çizelgesine tıklayıp oynatma kafasını taşıyın. Klipi sürükleyip görünme zamanını değiştirin veya başka ize taşıyın; uçlarını sürükleyip kısaltın. Klipi sağ tıklayıp bölün, kopyalayın, kapatın veya silin."
        ],
        [
          "Sağ: içerik ve özellikler",
          "Dikey araç çubuğunda yukarıdan aşağıya Döküm, Altyazı, Öğeler, Metin, Görseller, Video, Ses, Marka ve Denetçi vardır. Klip seçince özelliklerine geçilir; seçim yoksa Denetçi tüm videonun “Video özellikleri” kısmını gösterir."
        ]
      ],
      "tip": "Hata mı yaptınız? Önce geri alın (⌘Z / Ctrl+Z). Video çubuğundaki “Sürümler” geçmişi açar; tek düzenlemeyi ayrı geri alabilirsiniz."
    },
    "style": {
      "title": "Altyazı görünümünü değiştirin",
      "short": null,
      "summary": "Altyazı seçip Denetçi içinde konum, metin stili ve zamanlamasını değiştirin.",
      "keywords": "stil yazı tipi boyut renk kontur arka plan gölge parıltı konum iki dil satır aralığı noktalama",
      "steps": [
        [
          "Altyazı seç",
          "Zaman çizelgesinde altyazıya tıklayın; sağ panel “Altyazı özellikleri” kısmına geçer. Burada altyazı stilini değiştirirsiniz; aynı stili kullanan tüm altyazılar birlikte değişir."
        ],
        [
          "Konum ve metin stilini ayarla",
          "“Konum” dikey ve yatay yerleşimi ve genişliği ayarlar; “Metin stili” yazı tipi, boyut, renk ve hizalamayı ayarlar, arka plan, kontur, parıltı ve gölgeyi açabilir. Sürüklerken görüntü güncellenir; bırakınca değişiklik kaydedilir."
        ],
        [
          "Zamanlamayı ayarla",
          "“Gösterim” altındaki “Daha erken” ve “Daha geç” satırın konuşmadan ne kadar önce göründüğünü ve ne kadar sonra kaybolduğunu ayarlar; “Noktalama” virgül ve noktaları boşlukla değiştirebilir."
        ]
      ],
      "tip": "Zaman çizelgesinde hem kaynak hem çeviri altyazısı varsa “Altyazı özellikleri” içine “İki dilli” kısmı eklenir; üstteki satırı ve aralarındaki uzaklığı ayarlar. Sorun olursa geri alın (⌘Z / Ctrl+Z).",
      "cta": "Altyazı özelliklerini aç"
    },
    "elements": {
      "title": "Metin, çıkartma ve şekil ekle",
      "short": null,
      "summary": "Sağ panelden görüntüye öğe ekleyip Denetçi içinde konum ve stilini ayarlayın.",
      "keywords": "öğe çıkartma şekil görselleştirici ilerleme çubuğu sayaç geri sayım dalga formu metin kutusu başlık alt üçte bir ön ayar",
      "steps": [
        [
          "Öğe seç",
          "Sağdaki “Öğeler” çıkartma, şekil ve görselleştirici olarak düzenlenir ve aranabilir; görselleştiriciler ilerleme çubuğu, sayaç ve dalga formu içerir. Birine tıklayıp zaman çizelgesine ekleyin: çoğu oynatma kafasında başlar; ilerleme çubuğu gibi öğeler tüm videoyu kaplar."
        ],
        [
          "Metin ekle",
          "Sağdaki “Metin” içinde “Metin kutusu ekle” tıklayın veya Sade, Başlık veya Alt üçte bir gibi ön ayar seçin."
        ],
        [
          "Zamanlama ve konumu ayarla",
          "Eklenen her öğe zaman çizelgesinde aralık kaplar; sürükleyip görünme zamanını değiştirin. Seçilince sağ panel özelliklerini gösterir; “Geometri” ile konum, boyut, döndürme ve çevirmeyi sayısal ayarlayın."
        ]
      ],
      "tip": "Öğe seçiliyken sağ panel özelliklerini gösterir; Esc ile seçimi kaldırınca Denetçi “Video özellikleri” kısmına döner."
    },
    "reframe": {
      "title": "Yatay videoyu dikey yapın",
      "short": null,
      "summary": "Video özelliklerinde en boy oranını değiştirin; görüntüdeki klipler tuvalle ölçeklenir.",
      "keywords": "dikey yatay portre manzara en boy oranı 9:16 1:1 4:3 16:9 tuval kadraj yeniden çerçevele",
      "steps": [
        [
          "Video özelliklerini aç",
          "Esc ile klip seçimini kaldırın, sonra sağdaki “Denetçi” açın; “Video özellikleri” görünür."
        ],
        [
          "Başka en boy oranı seç",
          "“En boy oranı” 16:9, 9:16, 1:1 ve 4:3 sunar. Kısa kenar aynı kalır; görüntüdeki klipler tuvalle orantılı taşınıp ölçeklenir, tuvali dolduran klipler yine doldurur, kilitli klipler hareket etmez."
        ],
        [
          "Klip klip kadraj ayarla",
          "Kadrajı değişecek klipi seçip özelliklerindeki “Geometri” içinde konum ve boyutunu ayarlayın."
        ]
      ],
      "tip": "En boy oranı değiştirmek sıradan düzenlemedir; beğenmezseniz geri alın (⌘Z / Ctrl+Z). Ana özneyi otomatik bulan akıllı kırpma burada yok; kadrajı kendiniz ayarlarsınız."
    },
    "aitools": {
      "title": "Ajanla dökümü düzenleyin",
      "short": null,
      "summary": "Düzeltme, bölümler, konuşmacılar, kesim bulma, çeviri, dublaj ve yayın için yazma oturumda / veya ilgili panel düğmesinden başlar, varsayılan olarak ajana gider.",
      "keywords": "AI araçlar eğik çizgi düzelt paragraf bölüm konuşmacı dolgu duraklama yeniden yazıya dök güncel değil çeviri dublaj özet blog başlık açıklama kapak temizle",
      "steps": [
        [
          "Oturumda / yaz",
          "Oturum girdisinin başında / yazın (veya “+” altında “Araç kullan” seçin); bu video için araçlar listelenir: Dökümü düzelt, Bölüm oluştur, Konuşmacıları belirle, Yeniden yazıya dök, Kesimleri bul, Altyazıları çevir, Eski çevirileri güncelle, Çeviri dublajı, Özet yaz, Blog yazısı yaz, Başlık öner, Açıklama yaz, Kapak oluştur ve Dışa aktar. Birini seçip ardından gereksinimlerinizi ekleyin ve gönderin; ajan çalışmaya başlar. Space içinden açılan videoda oturum sağ alttadır; bu araçlar web üzerinde yoktur."
        ],
        [
          "Ya da AI araçları sekmesini aç",
          "Düzenleyicinin sağındaki “AI araçları” sekmesi araçları gruplar hâlinde listeler: dökümü düzeltme, bölüm oluşturma, konuşmacıları tanıma, yeniden döküm ve kesilecek yerleri bulma; ardından özet, blog yazısı, başlık, açıklama ve kapak. Kesme modu ipucu çubuğundaki “Kesilecek yerleri bul” da aynı sayfayı açar. Birini seçip sayfasını aç, kapsamı ve seçenekleri belirle. Alttaki istem kutusu bunlara göre isteği yazar ve aracın skill’ini ekler; metni düzenleyebilirsin. “Oturum” satırında yeni oturumu ya da mevcut oturumu seç ve “Ajana ver”e tıkla. Altyazı çevirisi Altyazılar panelindeki “+ Çevir…” içinde, seslendirme çevirisi Ses panelinde ve seslendirme kanalının menüsündedir; bu ikisinde ayarlar sayfasında bir model seçip doğrudan başlarsın.",
        ],
        [
          "Sonuçları denetle",
          "Ajan videoyu her değiştirdiğinde oturumda değişiklik kartı çıkar; doğrudan geri alabilirsiniz. Bölüm oluşturmadan önce düzeltin, bölümler paragraf bazında gruplanır. Yazma ve yayın sonuçları oturumda okuma, seçme ve kopyalama içindir; dökümü değiştirmez. Kaynağı düzenledikten sonra “Eski çevirileri güncelle” yalnızca “Güncel değil” satırlarını yeniden çevirir."
        ]
      ],
      "tip": "Listede olmayan şey için oturumda tek cümle söyleyin. Akıllı kırpma ve Kısa videolara böl bu sürümde yoktur."
    },
    "agent": {
      "title": "Videonuzda ajanı çalıştırın",
      "short": null,
      "summary": "İsteğinizi tek cümlede söyleyin, adım adım çalışmasını izleyin, sonucu denetleyin.",
      "keywords": "AI yardımcı ajan oturum sohbet otomatik onay izin geri al codex claude",
      "steps": [
        [
          "Önce ajan bağla",
          "“Ayarlar › Ajan sağlayıcıları” açın. BaoCut bu bilgisayarda Claude Code ve Codex algılar; yüklü değilse kartındaki adımlarla yükleyip giriş yapın, sonra dönüp yeniden algılayın."
        ],
        [
          "Oturumda ne istediğini söyle",
          "Home içinde oturum başlatın veya Space içinde video açın: sağ altta varsayılan açık yüzen oturum vardır, orada konuşun. Küçültülünce sağ altta simge olur; tıklayıp tekrar açın. Kapsamı ve korunacakları açık söyleyin, örneğin: “Bu röportajın altyazılarında yazım hatalarını kontrol et ama konuşma dilini koru.”"
        ],
        [
          "Süreci izle ve sonucu denetle",
          "Ajanın her adımı açılabilir. Seçtiğiniz erişim moduna göre komut veya değişiklik öncesinde izin veya ret ister; videoyu her değiştirdiğinde oturumda değişiklik kartı çıkar ve doğrudan geri alabilirsiniz."
        ]
      ],
      "tip": "Ajan yalnızca oturumun klasöründeki videoları kullanabilir (proje klasörü veya oturumun kendi çalışma klasörü). Mesaj gönderirken düzenleyicide böyle bir video açıksa seçim ve oynatma kafasıyla eklenir; girdi kutusunun üstündeki başvuruyu kaldırabilirsiniz.",
      "cta": "Ajan ayarlarını aç"
    },
    "missing": {
      "title": "Altyazılar neden görüntüde görünmüyor?",
      "short": null,
      "summary": "Sırayla altyazıların zaman çizelgesinde olduğunu, oynatma kafasının yerini ve iz anahtarlarını denetleyin.",
      "keywords": "görünmüyor eksik gizli kapalı boş altyazı yazıya dökme",
      "steps": [
        [
          "Altyazıların zaman çizelgesinde olduğundan emin ol",
          "Ajan veya komut satırının yazıya dökme işlemlerii yalnızca döküm olarak kaydedilir, zaman çizelgesini değiştirmez. Sağda “Altyazı” açın: “Henüz altyazı yok” yazıyorsa “Altyazı oluştur” tıklayın, altyazı dosyası içe aktarın veya ajandan dökümü zaman çizelgesine koymasını isteyin."
        ],
        [
          "Konuşma olan satıra git",
          "“Altyazı” içinde satırın zamanına tıklayın; oynatma kafası oraya gider. Konuşmasız boşluklarda zaten altyazı olmaz."
        ],
        [
          "İz ve klip anahtarlarını denetle",
          "Altyazı izinin başlığına bakın: göz simgesi kapalıysa iz önizlemede görünmez. Kapalı klipler de görüntüde atlanır; sağ tıklayıp “Bu klipi etkinleştir” seçin."
        ]
      ],
      "tip": "Hâlâ görünmüyor mu? Altyazıyı seçip “Altyazı özellikleri” içinde konum ve rengi denetleyin: metin görüntünün dışına çıkmış veya arka plana çok yakın olabilir.",
      "cta": "Altyazıları denetle"
    },
    "model": {
      "title": "Yazıya dökme veya oluşturma başlamadı. Ne yapmalı?",
      "short": null,
      "summary": "Önce Arka plan görevleri kısmında nedeni kontrol edin, sonra eksik model hizmetini ekleyin.",
      "keywords": "başarısız hata yazıya dökme konuşma sentezi görsel oluşturma model hizmet bileşen ağ görev",
      "steps": [
        [
          "Arka plan görevlerini aç",
          "Soldaki “Arka plan görevleri” düzenleyici, Home işlem hattı, ajan veya komut satırından gelen tüm arka plan görevlerini listeler. Görevin “Ayrıntılar” kısmına tıklayın: başarısızsa kırmızı kutudaki başlık nedenidir."
        ],
        [
          "Ayrıntılardaki eksiği tamamla",
          "Ayrıntılar nedenine göre sonraki adımı verir: bileşen yükleme, bulut modeli ayarlama, varsayılan model seçme veya ajan ayarlarını denetleme gibi."
        ],
        [
          "Geri dön ve yeniden dene",
          "Düzeltince geri dönüp yeniden deneyin: Altyazı panelinde tekrar “Altyazı oluştur” tıklayın veya oturumda ajandan yeniden göndermesini isteyin. Hizmet yoksa ajan önce hangisini açacağınızı söyler."
        ]
      ],
      "tip": "Yazıya dökme, konuşma sentezi ve görsel oluşturma model hizmeti gerektirir. Yardım çevrimdışı okunabilir, bulut hizmetleri ağ bağlantısı ister.",
      "cta": "Modelleri gör"
    }
  }
};
