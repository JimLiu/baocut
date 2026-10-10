import type { HelpGuidesMessages } from './help-guides.ts';

export const vi: HelpGuidesMessages = {
  "guides": {
    "import": {
      "title": "Tạo video và nhập tư liệu",
      "short": "Tạo và nhập",
      "summary": "Tạo video trong Space rồi đưa tư liệu vào thư viện tư liệu và dòng thời gian.",
      "keywords": "mới tạo tệp tư liệu thư viện nhập kéo thả âm thanh hình ảnh video",
      "steps": [
        [
          "Tạo video",
          "Mở “Space” bên trái, nhấp “Mới” → “Video trống mới”, chọn dự án rồi chọn tỷ lệ khung hình trong Home và nhấp “Tạo video trống”. Nếu có tệp video hoặc âm thanh, nhấp “Video mới từ tệp”; Home mở với tệp đó và cho chọn thêm phụ đề hoặc chép lời và dịch. Nếu chưa có dự án, mở thư mục dự án trong Home trước hoặc nhờ Agent tạo trong phiên."
        ],
        [
          "Nhập tư liệu vào thư viện",
          "Trong bảng bên phải trình chỉnh sửa, mở “Video”, “Âm thanh” hoặc “Hình ảnh”, nhấp “Nhập” rồi chọn tệp hoặc kéo vào khung nét đứt. Nhập chỉ sao chép tệp vào thư mục video; không đụng đến tệp gốc."
        ],
        [
          "Đặt lên dòng thời gian",
          "Nhấp “+” bên phải hàng tư liệu để đặt tại đầu phát. Cũng có thể kéo tư liệu vào hàng trên dòng thời gian hoặc kéo tệp từ máy tính trực tiếp lên dòng thời gian."
        ]
      ],
      "tip": "Nhập và đặt lên dòng thời gian là hai bước: tư liệu mới nhập nằm trong thư viện, chưa xuất hiện trong hình.",
      "cta": "Video mới từ tệp"
    },
    "subtitle": {
      "title": "Thêm phụ đề và hiệu đính từng dòng",
      "short": "Thêm phụ đề",
      "summary": "Nhập tệp phụ đề hoặc để Agent chép lời rồi nghe và sửa phụ đề cho chính xác.",
      "keywords": "chép lời nhận dạng srt vtt webvtt ass lỗi chữ tách ghép tìm thay bản chép lời phụ đề",
      "steps": [
        [
          "Lấy phụ đề trước",
          "Mở “Phụ đề” bên phải. Khi video có tư liệu, nhấp “Tạo phụ đề” để chép lời bằng mô hình giọng nói trên thiết bị hoặc dịch vụ đám mây đã kết nối; khi xong, phụ đề tự vào hình. “Cài đặt chép lời” thu gọn dưới nút cho đổi ngôn ngữ, mô hình và gợi ý nhận dạng. Nếu đã có tệp phụ đề, nhấp “Nhập tệp phụ đề”; hỗ trợ SRT, WebVTT và ASS. Để đánh dấu ai nói, dùng “Công cụ › Chép lời”: mở “Thêm tùy chọn” dưới mô hình và bật “Nhận dạng người nói”. MOSS Transcribe tự phân biệt người nói nên luôn bật; mô hình trên thiết bị khác cần “Phân biệt người nói”, lần bật đầu sẽ yêu cầu tải."
        ],
        [
          "Nhấp dòng và sửa",
          "Nhấp thời gian của dòng để chuyển đầu phát đến đó; nhấp văn bản để sửa. Enter tách thành hai dòng, Backspace ở đầu dòng ghép vào dòng trước, Shift+Enter thêm xuống dòng trong dòng và Esc bỏ chỉnh sửa."
        ],
        [
          "Nghe lại rồi sửa mọi nơi cùng lúc",
          "Sau khi rời ô văn bản, nhấn Space để phát và đối chiếu lời nói. Đầu bảng hiện số dòng vượt tốc độ đọc. Khi cùng lỗi cần sửa nhiều nơi, dùng tìm và thay thế (⌘F / Ctrl+F)."
        ]
      ],
      "tip": "Chỉ chép lời bắt đầu từ “Tạo phụ đề” tự vào hình. Khi Agent chép lời trong phiên, kết quả được lưu thành bản chép lời trước; trở lại “Phụ đề” và nhấp “Tạo phụ đề” để dùng. Khi dòng thời gian có nhiều rãnh phụ đề, dùng menu ở tiêu đề “Phụ đề” để chọn rãnh cần sửa.",
      "cta": "Mở Phụ đề"
    },
    "translate": {
      "title": "Thêm bản dịch cho phụ đề song ngữ",
      "short": "Dịch và song ngữ",
      "summary": "Trong bảng Phụ đề, chọn ngôn ngữ đích và mô hình văn bản; bản dịch vào hình thành rãnh phụ đề mới.",
      "keywords": "dịch bản dịch tiếng Anh tiếng Trung song ngữ ngôn ngữ nguồn cạnh nhau bảng thuật ngữ mô hình văn bản",
      "steps": [
        [
          "Hiệu đính nguồn trước",
          "Dịch xử lý văn bản đã chép lời từng câu nên sửa tên, thuật ngữ và lỗi nhận dạng rõ trước để giảm chỉnh sửa sau. Phụ đề dịch phải từ chép lời: tệp phụ đề nhập không có thời gian từng từ nên không dịch trực tiếp được."
        ],
        [
          "Nhấp “+ Dịch sang…” trên thanh rãnh",
          "Mở “Phụ đề” bên phải, nhấp “+ Dịch sang…” trên thanh rãnh, chọn ngôn ngữ đích và mô hình văn bản, thêm gợi ý phong cách hoặc chọn bảng thuật ngữ nếu cần rồi nhấp nút bắt đầu phía dưới. Nếu chưa có mô hình văn bản, kết nối dịch vụ trong “Mô hình › Tạo văn bản” trước; mô hình trực tuyến tính phí theo token."
        ],
        [
          "Kiểm tra bản dịch và chỉnh bố cục song ngữ",
          "Khi xong, bản dịch tự vào hình và thẻ kết quả cho hoàn tác bằng một lần nhấp. Trong “Danh sách”, chọn “Bản gốc + Bản dịch” để đối chiếu từng dòng; nhấp dòng dịch để viết lại. Chọn phụ đề, mục “Song ngữ” trong “Thuộc tính phụ đề” đặt dòng ở trên và khoảng cách hai dòng."
        ]
      ],
      "tip": "Muốn chỉ hiện bản dịch? Tắt “Hiện cả hai ngôn ngữ” trước khi bắt đầu hoặc nhấp “×” trên nguồn trong thanh rãnh để bỏ khỏi hình; nguồn không bị xóa. Sau khi sửa nguồn, bản dịch bị ảnh hưởng được đánh dấu “Lỗi thời”: viết lại sẽ bỏ dấu. Cũng có thể nhấp “Cập nhật bản dịch cũ” trên thông báo trong ứng dụng máy tính hoặc gõ /refresh trong phiên để Agent dịch lại những dòng này.",
      "cta": "Mở Phụ đề"
    },
    "export": {
      "title": "Xuất video, phụ đề hoặc bản chép lời",
      "short": "Xuất",
      "summary": "Chọn sản phẩm bàn giao theo nhu cầu; với video và âm thanh cũng có thể chỉ xuất vài chương hoặc đoạn.",
      "keywords": "xuất lưu tải mp4 wav mp3 m4a srt vtt ass json markdown bản chép lời chương đoạn độ lớn âm thanh tệp dự án premiere davinci resolve gói di động",
      "steps": [
        [
          "Nhấp “Xuất” trong thanh video",
          "Nhấp “Xuất” bên phải thanh video của trình chỉnh sửa. Năm sản phẩm có trang riêng: Video (MP4), Âm thanh (WAV, MP3 hoặc M4A), Phụ đề (SRT, VTT, ASS hoặc JSON), Bản chép lời (Markdown hoặc văn bản thuần) và Tệp dự án (XML cho Premiere Pro, DaVinci Resolve hoặc gói di động BaoCut)."
        ],
        [
          "Chọn phạm vi và xác nhận cài đặt",
          "Video và âm thanh có thể xuất toàn bộ video, theo chương, theo đoạn hoặc bắt đầu và kết thúc tùy chỉnh; phụ đề, bản chép lời và tệp dự án xuất toàn bộ chuỗi. Trên trang Video, xác nhận độ phân giải, kích thước tệp, có ghi phụ đề vào hình không và bật chuẩn hóa độ lớn nếu cần. Trang Phụ đề cho chọn hai rãnh để ghép thành tệp song ngữ."
        ],
        [
          "Bắt đầu xuất và chờ xong",
          "Mặc định lưu vào exports/ trong dự án hoặc nhấp “Chọn vị trí” trước. Có thể đóng hộp thoại và tiếp tục làm khi xuất; tiến độ hiện trên nút “Xuất” và trong “Tác vụ nền”. Khi xong, nhấp “Hiện trong thư mục” để tìm tệp; nếu thất bại, hộp thoại cho biết lý do và bước tiếp theo."
        ]
      ],
      "tip": "Tệp phụ đề và video có phụ đề là hai sản phẩm khác nhau: tệp để nạp vào phần mềm khác, video để phát và chia sẻ trực tiếp."
    },
    "workspace": {
      "title": "Làm quen với trình chỉnh sửa",
      "short": null,
      "summary": "Xem kết quả trong xem trước, tìm khoảnh khắc trên dòng thời gian và đổi nội dung ở bảng phải.",
      "keywords": "sân khấu khung vẽ xem trước dòng thời gian bảng thuộc tính rãnh phát không tìm thấy",
      "steps": [
        [
          "Giữa: xem trước",
          "Hiện hình ở đầu phát, với kích thước và tốc độ khung hình video phía trên. Điều khiển phát phía dưới cho phát, bước từng khung hình, hoàn tác, làm lại và tách tại đầu phát."
        ],
        [
          "Dưới: dòng thời gian",
          "Nhấp dòng thời gian để chuyển đầu phát. Kéo clip để đổi thời điểm xuất hiện hoặc sang rãnh khác, kéo hai đầu để cắt tỉa. Nhấp phải clip để tách, sao chép, tắt hoặc xóa."
        ],
        [
          "Phải: nội dung và thuộc tính",
          "Thanh công cụ dọc từ trên xuống có Bản chép lời, Phụ đề, Phần tử, Văn bản, Hình ảnh, Video, Âm thanh, Thương hiệu và Bảng thuộc tính. Chọn clip chuyển đến thuộc tính; không chọn gì thì Bảng thuộc tính hiện “Thuộc tính video” cho toàn bộ video."
        ]
      ],
      "tip": "Lỡ thao tác sai? Hoàn tác trước (⌘Z / Ctrl+Z). “Phiên bản” trong thanh video mở lịch sử, nơi có thể hoàn tác riêng từng chỉnh sửa."
    },
    "style": {
      "title": "Đổi cách phụ đề hiển thị",
      "short": null,
      "summary": "Chọn phụ đề và đổi vị trí, kiểu chữ và thời gian trong Bảng thuộc tính.",
      "keywords": "kiểu phông cỡ màu viền nét nền bóng phát sáng vị trí song ngữ khoảng cách dòng dấu câu",
      "steps": [
        [
          "Chọn phụ đề",
          "Nhấp phụ đề trên dòng thời gian, bảng phải chuyển sang “Thuộc tính phụ đề”. Thay đổi ở đây là kiểu phụ đề nên mọi phụ đề dùng cùng kiểu đổi cùng nhau."
        ],
        [
          "Chỉnh vị trí và kiểu chữ",
          "“Vị trí” đặt vị trí dọc, ngang và chiều rộng; “Kiểu chữ” đặt phông, cỡ, màu, căn chỉnh và bật nền, viền, phát sáng, bóng. Hình thay đổi khi kéo, chỉnh sửa lưu khi thả."
        ],
        [
          "Chỉnh thời gian",
          "“Sớm hơn” và “Muộn hơn” trong “Hiển thị” đặt mỗi dòng xuất hiện bao lâu trước lời nói và biến mất bao lâu sau đó; “Dấu câu” có thể đổi dấu phẩy, chấm thành dấu cách."
        ]
      ],
      "tip": "Khi dòng thời gian có cả phụ đề nguồn và dịch, “Thuộc tính phụ đề” thêm mục “Song ngữ” đặt dòng trên và khoảng cách hai dòng. Nếu sai, hoàn tác (⌘Z / Ctrl+Z).",
      "cta": "Mở thuộc tính phụ đề"
    },
    "elements": {
      "title": "Thêm văn bản, nhãn dán và hình dạng",
      "short": null,
      "summary": "Thêm nội dung vào hình từ bảng phải rồi chỉnh vị trí và kiểu trong Bảng thuộc tính.",
      "keywords": "phần tử nhãn dán hình dạng hình trực quan thanh tiến độ bộ đếm đếm ngược dạng sóng văn bản hộp chữ tiêu đề dải chữ dưới thiết lập sẵn",
      "steps": [
        [
          "Chọn phần tử",
          "“Phần tử” bên phải chia thành nhãn dán, hình dạng và hình trực quan, có thể tìm kiếm; hình trực quan gồm thanh tiến độ, bộ đếm và dạng sóng. Nhấp một mục để thêm vào dòng thời gian: phần lớn bắt đầu tại đầu phát, mục như thanh tiến độ trải suốt video."
        ],
        [
          "Thêm văn bản",
          "Trong “Văn bản” bên phải, nhấp “Thêm hộp văn bản” hoặc chọn thiết lập sẵn như Đơn giản, Tiêu đề hoặc Dải chữ dưới."
        ],
        [
          "Chỉnh thời gian và vị trí",
          "Mỗi phần tử chiếm một khoảng trên dòng thời gian; kéo để đổi thời điểm xuất hiện. Khi chọn, bảng phải hiện thuộc tính; dùng “Hình học” để đặt vị trí, kích thước, xoay và lật bằng giá trị."
        ]
      ],
      "tip": "Khi chọn phần tử, bảng phải hiện thuộc tính; nhấn Esc bỏ chọn và Bảng thuộc tính trở về “Thuộc tính video”."
    },
    "reframe": {
      "title": "Chuyển video ngang thành dọc",
      "short": null,
      "summary": "Đổi tỷ lệ trong Thuộc tính video; clip trong hình đổi tỷ lệ theo khung vẽ.",
      "keywords": "dọc ngang chân dung phong cảnh tỷ lệ 9:16 1:1 4:3 16:9 khung vẽ khuôn hình đổi khung",
      "steps": [
        [
          "Mở thuộc tính video",
          "Nhấn Esc bỏ chọn clip rồi mở “Bảng thuộc tính” bên phải; hiện “Thuộc tính video”."
        ],
        [
          "Chọn tỷ lệ khác",
          "“Tỷ lệ khung hình” có 16:9, 9:16, 1:1 và 4:3. Cạnh ngắn giữ nguyên; clip trong hình di chuyển và đổi tỷ lệ theo khung vẽ, clip lấp đầy vẫn lấp đầy, clip khóa không di chuyển."
        ],
        [
          "Chỉnh khuôn hình từng clip",
          "Chọn clip cần chỉnh khung rồi đặt vị trí và kích thước trong “Hình học” của thuộc tính."
        ]
      ],
      "tip": "Đổi tỷ lệ là chỉnh sửa thông thường; nếu không thích, hoàn tác (⌘Z / Ctrl+Z). Không có cắt thông minh tự tìm chủ thể ở đây nên bạn tự chỉnh khuôn hình."
    },
    "aitools": {
      "title": "Nhờ Agent chỉnh bản chép lời",
      "short": null,
      "summary": "Trau chuốt, chương, người nói, tìm phần có thể cắt, dịch, lồng tiếng và viết để xuất bản bắt đầu từ / trong phiên hoặc nút ở bảng liên quan và mặc định giao Agent.",
      "keywords": "AI công cụ gạch chéo trau chuốt đoạn chương người nói từ đệm ngắt chép lời lại bản dịch lỗi thời lồng tiếng tóm tắt blog tiêu đề mô tả bìa dọn",
      "steps": [
        [
          "Gõ / trong phiên",
          "Gõ / ở đầu ô nhập phiên (hoặc chọn “Dùng công cụ” dưới “+”) để liệt kê công cụ cho video: Trau chuốt bản chép lời, Tạo chương, Nhận dạng người nói, Chép lời lại, Tìm phần có thể cắt, Dịch phụ đề, Cập nhật bản dịch cũ, Lồng tiếng bản dịch, Viết tóm tắt, Viết bài blog, Gợi ý tiêu đề, Viết mô tả, Tạo bìa và Xuất. Chọn một, thêm yêu cầu phía sau rồi gửi; Agent bắt đầu làm. Với video mở từ Space, phiên nằm góc dưới phải; công cụ này không có trên web."
        ],
        [
          "Hoặc mở thẻ Công cụ AI",
          "Thẻ “Công cụ AI” ở thanh bên phải trình chỉnh sửa liệt kê công cụ theo nhóm: trau chuốt bản chép lời, tạo chương, nhận diện người nói, chép lời lại và tìm đoạn cần cắt, rồi viết tóm tắt, bài blog, tiêu đề, mô tả và ảnh bìa. “Tìm đoạn cần cắt” trên thanh gợi ý của chế độ cắt cũng mở cùng trang đó. Chọn một công cụ để mở trang của nó, rồi chọn phạm vi và tùy chọn. Ô lời nhắn bên dưới viết sẵn yêu cầu theo đó và gắn skill của công cụ; bạn có thể sửa. Ở dòng “Phiên”, chọn phiên mới hoặc phiên hiện tại rồi bấm “Giao cho Agent”. Dịch phụ đề nằm ở “+ Dịch sang…” trong bảng Phụ đề, dịch lồng tiếng nằm trong bảng Âm thanh và menu của rãnh lồng tiếng; với hai mục này bạn chọn mô hình ở trang cài đặt và bắt đầu ngay.",
        ],
        [
          "Kiểm tra kết quả",
          "Mỗi lần Agent đổi video, thẻ thay đổi xuất hiện trong phiên và có thể hoàn tác trực tiếp. Trau chuốt trước khi tạo chương để chương nhóm theo đoạn. Kết quả viết và xuất bản để đọc, chọn, sao chép trong phiên; không đổi bản chép lời. Sau khi sửa nguồn, dùng “Cập nhật bản dịch cũ” để chỉ dịch lại dòng đánh dấu “Lỗi thời”."
        ]
      ],
      "tip": "Với nội dung ngoài danh sách, chỉ cần nói một câu trong phiên. Cắt thông minh và Cắt thành video ngắn chưa có trong phiên bản này."
    },
    "agent": {
      "title": "Nhờ Agent làm việc trên video",
      "short": null,
      "summary": "Nói yêu cầu trong một câu, xem làm từng bước rồi kiểm tra kết quả.",
      "keywords": "AI trợ lý Agent phiên trò chuyện tự động phê duyệt quyền hoàn tác codex claude",
      "steps": [
        [
          "Kết nối Agent trước",
          "Mở “Cài đặt › Nhà cung cấp Agent”. BaoCut phát hiện Claude Code và Codex trên máy tính này; nếu chưa cài, làm theo bước trên thẻ để cài và đăng nhập rồi trở lại phát hiện lại."
        ],
        [
          "Nói yêu cầu trong phiên",
          "Bắt đầu phiên trong Home hoặc mở video trong Space: phiên nổi mặc định mở nằm góc dưới phải, nói tại đó. Khi thu nhỏ thành biểu tượng góc dưới phải, nhấp để mở lại. Nêu rõ phạm vi và phần cần giữ, ví dụ: “Kiểm tra lỗi chính tả trong phụ đề phỏng vấn này nhưng giữ cách nói trò chuyện.”"
        ],
        [
          "Xem quá trình và kiểm tra kết quả",
          "Mỗi bước Agent thực hiện có thể mở rộng. Theo chế độ truy cập đã chọn, sẽ hỏi cho phép hoặc từ chối trước khi chạy lệnh hoặc chỉnh sửa; mỗi lần đổi video có thẻ thay đổi trong phiên, có thể hoàn tác trực tiếp."
        ]
      ],
      "tip": "Agent chỉ dùng video trong thư mục phiên (thư mục dự án hoặc thư mục làm việc riêng). Khi gửi thông điệp, video như vậy đang mở trong trình chỉnh sửa được đính kèm cùng vùng chọn và đầu phát; có thể bỏ tham chiếu phía trên ô nhập.",
      "cta": "Mở cài đặt Agent"
    },
    "missing": {
      "title": "Tại sao không thấy phụ đề trong hình?",
      "short": null,
      "summary": "Kiểm tra theo thứ tự: phụ đề có trên dòng thời gian, vị trí đầu phát và công tắc rãnh.",
      "keywords": "không hiện thiếu ẩn tắt trống không thấy phụ đề chép lời",
      "steps": [
        [
          "Bảo đảm phụ đề trên dòng thời gian",
          "Chép lời bằng Agent hoặc dòng lệnh chỉ lưu kết quả thành bản chép lời, không đổi dòng thời gian. Mở “Phụ đề” bên phải: nếu hiện “Chưa có phụ đề”, nhấp “Tạo phụ đề”, nhập tệp phụ đề hoặc nhờ Agent đặt bản chép lời lên dòng thời gian."
        ],
        [
          "Đến dòng có người nói",
          "Nhấp thời gian dòng trong “Phụ đề”, đầu phát chuyển đến đó. Khoảng không có lời nói vốn không có phụ đề."
        ],
        [
          "Kiểm tra công tắc rãnh và clip",
          "Xem đầu rãnh phụ đề: khi biểu tượng mắt tắt, rãnh không hiện trong xem trước. Clip tắt cũng bị bỏ qua trong hình; nhấp phải rồi chọn “Bật clip này”."
        ]
      ],
      "tip": "Vẫn không thấy? Chọn phụ đề, kiểm tra vị trí và màu trong “Thuộc tính phụ đề”: chữ có thể ra ngoài hình hoặc quá giống nền.",
      "cta": "Kiểm tra Phụ đề"
    },
    "model": {
      "title": "Chép lời hoặc tạo chưa bắt đầu. Làm gì tiếp?",
      "short": null,
      "summary": "Kiểm tra lý do trong Tác vụ nền trước rồi thêm dịch vụ mô hình còn thiếu.",
      "keywords": "thất bại lỗi chép lời tổng hợp giọng nói tạo hình ảnh mô hình dịch vụ thành phần mạng tác vụ",
      "steps": [
        [
          "Mở Tác vụ nền",
          "“Tác vụ nền” bên trái liệt kê mọi tác vụ chạy nền từ trình chỉnh sửa, quy trình Home, Agent hoặc dòng lệnh. Nhấp “Chi tiết” của tác vụ: nếu thất bại, tiêu đề hộp đỏ là lý do."
        ],
        [
          "Bổ sung phần thiếu theo chi tiết",
          "Chi tiết đưa bước tiếp theo theo lý do như cài thành phần, thiết lập mô hình đám mây, chọn mặc định hoặc kiểm tra cài đặt Agent."
        ],
        [
          "Trở lại và thử lại",
          "Sau khi khắc phục, trở lại thử lại: nhấp “Tạo phụ đề” trong bảng Phụ đề hoặc nhờ Agent gửi lại trong phiên. Khi không có dịch vụ khả dụng, Agent cho biết cần bật dịch vụ nào trước."
        ]
      ],
      "tip": "Chép lời, tổng hợp giọng nói và tạo hình ảnh đều cần dịch vụ mô hình. Có thể đọc trợ giúp ngoại tuyến nhưng dịch vụ đám mây cần kết nối mạng.",
      "cta": "Xem mô hình"
    }
  }
};
