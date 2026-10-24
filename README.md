# Takım Scrum Boardu (Yerel)

Python ile çalışan, verileri bilgisayarınızda SQLite veritabanına kaydeden kişisel Scrum board uygulaması. Çalışırken internete bağlanmaz; üçüncü taraf CDN, bulut hesabı veya harici Python paketi kullanmaz.

## Gereksinim
- Windows 10/11
- Python 3.10 veya üzeri (standart Python kurulumu yeterli)

## Başlatma
1. ZIP dosyasını bir klasöre çıkarın.
2. `run_scrum_board.bat` dosyasına çift tıklayın.
3. Tarayıcı otomatik açılır. Açılmazsa `http://127.0.0.1:8765` adresine gidin.
4. Uygulamayı kapatmak için açılan siyah pencereyi kapatın veya `Ctrl+C` basın.

## Özellikler
- Scrum board: Yapılacak, Devam Ediyor, İncelemede ve Tamamlandı sütunları
- Sürükle-bırak ile görevleri sütunlar arasında taşıma
- Görev oluşturma, düzenleme ve silme
- Öncelik, sorumlu kişi, story point, hedef tarih ve etiketler
- Sprint oluşturma, sprint hedefi ve tarihleri, sprintler arası geçiş
- Backlog ekranı ve Backlog'a görev gönderme
- Arama ve öncelik filtresi
- Özet göstergeler ve JSON dışa aktarma
- Responsive arayüz

## Veriler ve yedekleme
Görevler, sprintler ve ayarlar `data/scrum_board.db` dosyasında saklanır. Bu dosyayı uygulama kapalıyken kopyalayarak tam yedek alabilirsiniz. Board ekranındaki dışa aktarma düğmesi ayrıca JSON yedeği indirir.

## Güvenlik ve gizlilik
Sunucu yalnızca bu bilgisayardaki `127.0.0.1` adresinde dinler; yerel ağdaki diğer cihazlara açılmaz. Veriler buluta gönderilmez. Uygulama açıkken siyah konsol penceresi açık kalmalıdır.

## Sorun giderme
- `Python bulunamadi` mesajında Python 3.10+ kurun; kurulumda **Add Python to PATH** seçeneğini etkinleştirin.
- `Address already in use` hatasında 8765 portu başka bir uygulama tarafından kullanılıyor olabilir. `app.py` içindeki `PORT = 8765` satırındaki numarayı değiştirip yeniden başlatın.
- Tarayıcı açılmazsa `http://127.0.0.1:8765` adresini kendiniz açın.
