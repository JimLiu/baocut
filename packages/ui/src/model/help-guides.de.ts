import type { HelpGuide } from './help-guides.ts';
type GuideId = 'import' | 'subtitle' | 'translate' | 'export' | 'workspace' | 'style' | 'elements' | 'reframe' | 'aitools' | 'agent' | 'missing' | 'model';
type GuideText = Pick<HelpGuide, 'title' | 'short' | 'summary' | 'keywords' | 'steps' | 'tip'> & { cta?: string };
import type { HelpGuidesMessages } from './help-guides.ts';

export const de: HelpGuidesMessages = {
  guides: {
    import: {
      title: "Video erstellen und Materialien importieren",
      short: "Erstellen und importieren",
      summary: "Video in Space erstellen und Materialien in Materialbibliothek und Zeitleiste übernehmen.",
      keywords: "neu erstellen Datei Material Materialbibliothek importieren ziehen ablegen Audio Bild Videoimport",
      steps: [
        [
          "Video erstellen",
          "Links „Space“ öffnen und „Neu“ → „Neues leeres Video“ wählen. Projekt auswählen, dann in Home Seitenverhältnis wählen und auf „Leeres Video erstellen“ klicken. Bei vorhandener Video- oder Audiodatei „Neues Video aus Datei“ wählen; Home öffnet sich mit der Datei und bietet Untertitel oder Transkription mit Übersetzung an. Ohne Projekt zuerst einen Projektordner in Home öffnen oder den Agenten in einer Sitzung mit der Erstellung beauftragen.",
        ],
        [
          "Materialien in Materialbibliothek importieren",
          "Im rechten Editorbereich „Video“, „Audio“ oder „Bilder“ öffnen und über „Importieren“ Dateien auswählen oder in den gestrichelten Bereich ziehen. Importieren kopiert Dateien nur in den Videoordner; Originaldateien bleiben unverändert.",
        ],
        [
          "In die Zeitleiste platzieren",
          "Rechts in der Materialzeile auf „+“ klicken, um am Abspielkopf zu platzieren. Alternativ Material in eine Zeitleistenspur ziehen oder Computerdatei direkt in die Zeitleiste ziehen.",
        ],
      ],
      tip: "Importieren und Platzieren sind getrennte Schritte: Neues Material liegt in der Materialbibliothek und erscheint noch nicht im Bild.",
      cta: "Neues Video aus Datei",
    },
    subtitle: {
      title: "Untertitel hinzufügen und zeilenweise Korrektur lesen",
      short: "Untertitel hinzufügen",
      summary: "Untertiteldatei importieren oder den Agenten transkribieren lassen; anschließend anhören und Untertitel korrigieren.",
      keywords: "transkribieren Transkription Erkennung srt vtt webvtt ass Tippfehler teilen zusammenführen suchen ersetzen Transkript Untertitel",
      steps: [
        [
          "Zuerst Untertitel erhalten",
          "Rechts „Untertitel“ öffnen. Bei vorhandenem Material mit „Untertitel erzeugen“ lokal oder über einen verbundenen Cloud-Dienst transkribieren; nach Abschluss erscheinen Untertitel automatisch im Bild. Unter dem Button stehen „Transkriptionseinstellungen“ für Sprache, Sprachmodell und Erkennungshinweise. Vorhandene Datei mit „Untertiteldatei importieren“ laden; SRT, WebVTT und ASS werden unterstützt. Sprecher über „Werkzeuge › Transkribieren“ erkennen: Unter dem Sprachmodell „Weitere Optionen“ öffnen und „Sprecher erkennen“ einschalten. MOSS Transcribe trennt Sprecher selbstständig; diese Option bleibt an. Andere lokale Modelle benötigen „Sprechertrennung“, die beim ersten Einschalten heruntergeladen wird.",
        ],
        [
          "Zeile anklicken und bearbeiten",
          "Auf die Zeit einer Zeile klicken, um den Abspielkopf dorthin zu bewegen; Text zum Bearbeiten anklicken. Enter teilt in zwei Zeilen, Backspace am Zeilenanfang verbindet mit der vorherigen, Shift+Enter fügt einen Zeilenumbruch ein, Esc verwirft.",
        ],
        [
          "Erneut anhören und Fehler überall korrigieren",
          "Nach Verlassen des Textfelds mit Space abspielen und Text mit Sprache vergleichen. Oben wird die Zahl der Zeilen über Lesegeschwindigkeit angezeigt. Häufige Fehler mit Suchen und Ersetzen (⌘F / Ctrl+F) korrigieren.",
        ],
      ],
      tip: "Nur über „Untertitel erzeugen“ gestartete Transkriptionen erscheinen automatisch im Bild. Agententranskription in einer Sitzung wird zuerst als Transkript gespeichert; unter „Untertitel“ mit „Untertitel erzeugen“ verwenden. Bei mehreren Untertitelspuren die zu bearbeitende über das Menü im Untertitel-Kopf auswählen.",
      cta: "Untertitel öffnen",
    },
    translate: {
      title: "Übersetzung für zweisprachige Untertitel hinzufügen",
      short: "Übersetzung und Zweisprachigkeit",
      summary: "Im Untertitel-Bereich Zielsprache und Textmodell auswählen; Übersetzung erscheint als neue Untertitelspur im Bild.",
      keywords: "übersetzen Übersetzung Englisch Chinesisch zweisprachig Sprache Quelle nebeneinander Glossar Textmodell",
      steps: [
        [
          "Quelle zuerst Korrektur lesen",
          "Übersetzung erfolgt Satz für Satz anhand des Transkripts. Namen, Begriffe und offensichtliche Erkennungsfehler zuerst korrigieren. Untertitel müssen aus Transkription stammen; importierte Untertiteldateien haben keine Wortzeiten und sind nicht direkt übersetzbar.",
        ],
        [
          "Im Spurenstreifen auf „+ Übersetzen nach…“ klicken",
          "Rechts „Untertitel“ öffnen und im Streifen „+ Übersetzen nach…“ wählen. Zielsprache und Textmodell auswählen, bei Bedarf Stilhinweis oder Glossar ergänzen und unten starten. Ohne Textmodell zuerst unter „Modelle › Texterzeugung“ einen Dienst verbinden; Onlinemodelle rechnen pro Token ab.",
        ],
        [
          "Übersetzung prüfen und zweisprachiges Layout anpassen",
          "Nach Abschluss erscheint die Übersetzung automatisch im Bild; die Ergebniskarte ermöglicht Rückgängigmachen mit einem Klick. Unter „Liste“ zur Ansicht „Quelle + Übersetzung“ wechseln und zeilenweise vergleichen. Übersetzte Zeile zum Umschreiben anklicken. Untertitel auswählen; der Bereich „Zweisprachig“ in den Untertiteleigenschaften regelt Zeilenreihenfolge und Abstand.",
        ],
      ],
      tip: "Nur Übersetzung anzeigen? Vor Start „Zweisprachige Anzeige“ ausschalten oder Quelle mit „×“ im Streifen ausblenden; sie wird nicht gelöscht. Nach Quelländerungen werden betroffene Übersetzungen als „Veraltet“ markiert; Umschreiben entfernt die Markierung. In der Desktop-App „Veraltete Übersetzungen erneuern“ anklicken oder in einer Sitzung /refresh eingeben, damit der Agent diese Zeilen erneut übersetzt.",
      cta: "Untertitel öffnen",
    },
    export: {
      title: "Video, Untertitel oder Transkript exportieren",
      short: "Exportieren",
      summary: "Passendes Ergebnisformat auswählen; Video und Audio auch nach wenigen Kapiteln oder Abschnitten exportierbar.",
      keywords:
        "exportieren speichern herunterladen mp4 wav mp3 m4a srt vtt ass json Markdown Transkript Kapitel Abschnitt Lautheit Projektdatei Premiere DaVinci Resolve portables Paket",
      steps: [
        [
          "In der Videoleiste auf „Exportieren“ klicken",
          "Rechts in der Editor-Videoleiste auf „Exportieren“ klicken. Fünf Seiten: Video (MP4), Audio (WAV, MP3 oder M4A), Untertitel (SRT, VTT, ASS oder JSON), Transkript (Markdown oder Klartext) und Projektdatei (XML für Premiere Pro und DaVinci Resolve oder portables BaoCut-Paket).",
        ],
        [
          "Bereich auswählen und Einstellungen bestätigen",
          "Video und Audio lassen sich vollständig, nach Kapitel, Abschnitt oder eigener Start-/Endzeit exportieren. Untertitel, Transkripte und Projektdateien exportieren die gesamte Sequenz. Unter Video Auflösung, Dateigröße, eingebrannte Untertitel und bei Bedarf Lautheitsnormalisierung festlegen. Unter Untertitel zwei Spuren für eine zweisprachige Datei auswählen.",
        ],
        [
          "Export starten und auf Abschluss warten",
          "Standardziel ist exports/ im Projekt; alternativ „Speicherort auswählen“. Dialog schließen und während Export weiterarbeiten; Fortschritt erscheint auf „Exportieren“ und unter „Hintergrundaufgaben“. Nach Abschluss mit „Im Ordner anzeigen“ die Datei öffnen. Bei Fehler zeigt der Dialog Grund und nächste Schritte.",
        ],
      ],
      tip: "Eine Untertiteldatei und ein Video mit Untertiteln sind verschiedene Ergebnisse: Erste für andere Software, zweites direkt abspielbar und teilbar.",
    },
    workspace: {
      title: "Editor kennenlernen",
      short: null,
      summary: "Ergebnis in der Vorschau sehen, Zeitpunkte in der Zeitleiste finden und Inhalte rechts ändern.",
      keywords: "Arbeitsfläche Vorschau Zeitleiste Bereich Inspektor Eigenschaften Spur Wiedergabe nicht gefunden",
      steps: [
        [
          "Mitte: die Vorschau",
          "Zeigt das Bild am Abspielkopf; Größe und Bildrate darüber. Darunter abspielen, frameweise bewegen, rückgängig machen, wiederholen und am Abspielkopf teilen.",
        ],
        [
          "Unten: die Zeitleiste",
          "Auf die Zeitleiste klicken, um den Abspielkopf zu bewegen. Clips zum Zeitpunktwechsel oder Spurwechsel ziehen, Enden zum Trimmen ziehen. Rechtsklick bietet Teilen, Kopieren, Deaktivieren und Löschen.",
        ],
        [
          "Rechts: Inhalte und Eigenschaften",
          "Die senkrechte Werkzeugleiste enthält von oben nach unten Transkript, Untertitel, Elemente, Text, Bilder, Video, Audio, Marke und Inspektor. Clipauswahl öffnet seine Eigenschaften; ohne Auswahl zeigt der Inspektor „Videoeigenschaften“ für das gesamte Video.",
        ],
      ],
      tip: "Fehler gemacht? Zuerst rückgängig machen (⌘Z / Ctrl+Z). „Versionen“ in der Videoleiste öffnet den Verlauf; dort sind einzelne Bearbeitungen unabhängig rückgängig zu machen.",
    },
    style: {
      title: "Untertiteldarstellung ändern",
      short: null,
      summary: "Untertitel auswählen und Position, Textstil und Timing im Inspektor ändern.",
      keywords: "Stil Schrift Größe Farbe Kontur Hintergrund Schatten Leuchten Position zweisprachig Zeilenabstand Zeichensetzung",
      steps: [
        [
          "Untertitel auswählen",
          "Untertitel in der Zeitleiste anklicken; rechts öffnen sich die „Untertiteleigenschaften“. Änderungen betreffen den Stil; alle Untertitel mit demselben Stil ändern sich gemeinsam.",
        ],
        [
          "Position und Textstil anpassen",
          "„Position“ regelt vertikale und horizontale Platzierung sowie Breite. „Textstil“ regelt Schrift, Größe, Farbe, Ausrichtung sowie Hintergrund, Kontur, Leuchten und Schatten. Das Bild folgt beim Ziehen; Loslassen speichert.",
        ],
        [
          "Timing anpassen",
          "„Früher“ und „Später“ unter „Anzeige“ regeln Erscheinen vor und Verschwinden nach der Sprache. „Zeichensetzung“ kann Kommas und Punkte durch Leerzeichen ersetzen.",
        ],
      ],
      tip: "Bei Original- und übersetzten Untertiteln erscheint unter „Untertiteleigenschaften“ der Bereich „Zweisprachig“ für Zeilenreihenfolge und Abstand. Bei Fehlern rückgängig machen (⌘Z / Ctrl+Z).",
      cta: "Untertiteleigenschaften öffnen",
    },
    elements: {
      title: "Text, Sticker und Formen hinzufügen",
      short: null,
      summary: "Über den rechten Bereich Inhalte zum Bild hinzufügen; Position und Stil im Inspektor anpassen.",
      keywords: "Elemente Sticker Form Visualisierung Fortschrittsbalken Timer Countdown Wellenform Text Textfeld Titel Bauchbinde Voreinstellung",
      steps: [
        [
          "Element auswählen",
          "„Elemente“ rechts enthält durchsuchbare Sticker, Formen und Visualisierungen. Visualisierungen umfassen Fortschrittsbalken, Timer und Wellenformen. Anklicken fügt sie in die Zeitleiste ein: meistens am Abspielkopf; Fortschrittsbalken etwa über die gesamte Videolänge.",
        ],
        ["Text hinzufügen", "Rechts unter „Text“ auf „Textfeld hinzufügen“ klicken oder eine Voreinstellung wie Einfach, Titel oder Bauchbinde wählen."],
        [
          "Timing und Position anpassen",
          "Jedes Element belegt einen Zeitleistenbereich; zum Zeitwechsel ziehen. Bei Auswahl erscheinen rechts Eigenschaften; „Geometrie“ regelt Position, Größe, Drehung und Spiegelung numerisch.",
        ],
      ],
      tip: "Bei Elementauswahl erscheinen rechts Eigenschaften. Esc hebt Auswahl auf; der Inspektor kehrt zu „Videoeigenschaften“ zurück.",
    },
    reframe: {
      title: "Querformatvideo in Hochformat umwandeln",
      short: null,
      summary: "Seitenverhältnis in Videoeigenschaften ändern; Bildclips skalieren mit der Arbeitsfläche.",
      keywords: "Hochformat Querformat vertikal horizontal Seitenverhältnis 9:16 1:1 4:3 16:9 Arbeitsfläche Bildausschnitt neu rahmen",
      steps: [
        ["Videoeigenschaften öffnen", "Mit Esc Clipauswahl aufheben und rechts „Inspektor“ öffnen; zeigt nun „Videoeigenschaften“."],
        [
          "Anderes Seitenverhältnis wählen",
          "„Seitenverhältnis“ bietet 16:9, 9:16, 1:1 und 4:3. Die kurze Seite bleibt gleich; Bildclips bewegen und skalieren proportional zur Arbeitsfläche, füllende Clips füllen weiterhin und gesperrte Clips bewegen sich nicht.",
        ],
        ["Bildausschnitt Clip für Clip anpassen", "Einen anzupassenden Clip auswählen und Position und Größe unter „Geometrie“ in seinen Eigenschaften ändern."],
      ],
      tip: "Seitenverhältnisänderung ist eine normale Bearbeitung; bei Nichtgefallen rückgängig machen (⌘Z / Ctrl+Z). Kein intelligentes Zuschneiden zur automatischen Motiverkennung; Bildausschnitt manuell anpassen.",
    },
    aitools: {
      title: "Transkript vom Agenten aufräumen lassen",
      short: null,
      summary:
        "Überarbeiten, Kapitel, Sprecher, Schnittsuche, Übersetzung, Vertonung und Veröffentlichungstexte beginnen über / in einer Sitzung oder einen Button im betreffenden Bereich und gehen standardmäßig an den Agenten.",
      keywords:
        "KI Werkzeuge Schrägstrich überarbeiten Absatz Kapitel Sprecher Füllwort Pause neu transkribieren veraltete Übersetzung Vertonung Zusammenfassung Blog Titel Beschreibung Titelbild aufräumen",
      steps: [
        [
          "/ in einer Sitzung eingeben",
          "/ am Anfang der Sitzungseingabe eingeben (oder „Werkzeug verwenden“ unter „+“ wählen), um Videowerkzeuge anzuzeigen: Transkript überarbeiten, Kapitel erzeugen, Sprecher erkennen, Neu transkribieren, Schnitte finden, Untertitel übersetzen, Veraltete Übersetzungen erneuern, Vertonung übersetzen, Zusammenfassung schreiben, Blogbeitrag schreiben, Titel vorschlagen, Beschreibung schreiben, Titelbild erstellen und Exportieren. Werkzeug wählen, Anforderungen ergänzen und senden; der Agent beginnt. Bei einem aus Space geöffneten Video liegt die Sitzung unten rechts. Im Web sind diese Werkzeuge nicht verfügbar.",
        ],
        [
          "Oder den Tab KI-Werkzeuge öffnen",
          "Der Tab „KI-Werkzeuge“ rechts im Editor listet die Werkzeuge nach Gruppen: Transkript überarbeiten, Kapitel erzeugen, Sprecher erkennen, neu transkribieren und Schnitte finden, danach Zusammenfassung, Blogartikel, Titel, Beschreibung und Cover. „Schnitte finden“ in der Hinweisleiste des Schnittmodus öffnet dieselbe Seite. Wählen Sie ein Werkzeug, dann Bereich und Optionen. Das Textfeld darunter formuliert daraus die Anfrage, mit dem Skill des Werkzeugs angehängt; Sie können es bearbeiten. Wählen Sie in der Zeile „Sitzung“ eine neue oder die aktuelle Sitzung und klicken Sie auf „An den Agenten übergeben“. Untertitel übersetzen liegt unter „+ Übersetzen in…“ im Untertitel-Panel, Synchronisation übersetzen im Audio-Panel und im Menü der Synchronspur; bei diesen beiden wählen Sie auf der Einstellungsseite ein Modell und starten direkt.",
        ],
        [
          "Ergebnisse prüfen",
          "Bei jeder Videoänderung durch den Agenten erscheint eine Änderungskarte; direkt rückgängig zu machen. Vor Kapitelerzeugung überarbeiten, damit Kapitel nach Absätzen gruppiert werden. Text- und Veröffentlichungsergebnisse werden in der Sitzung gelesen, ausgewählt und kopiert; sie ändern das Transkript nicht. Nach Quelländerung mit „Veraltete Übersetzungen erneuern“ nur als „Veraltet“ markierte Zeilen neu übersetzen.",
        ],
      ],
      tip: "Für nicht aufgeführte Aufgaben einen Satz in der Sitzung schreiben. Intelligentes Zuschneiden und Kurzclips erstellen sind in dieser Version nicht verfügbar.",
    },
    agent: {
      title: "Agenten am Video arbeiten lassen",
      short: null,
      summary: "Wunsch in einem Satz beschreiben, Schritte verfolgen und Ergebnis prüfen.",
      keywords: "KI Assistent Agent Sitzung Chat automatisch Genehmigung Berechtigung rückgängig Codex Claude",
      steps: [
        [
          "Zuerst Agenten verbinden",
          "„Einstellungen › Agentenanbieter“ öffnen. BaoCut erkennt Claude Code und Codex auf diesem Computer. Fehlt einer, seiner Kartenanleitung zur Installation und Anmeldung folgen; anschließend erneut erkennen.",
        ],
        [
          "Wunsch in einer Sitzung beschreiben",
          "Sitzung in Home starten oder Video in Space öffnen. Eine standardmäßig erweiterte schwebende Sitzung liegt unten rechts; dort schreiben. Minimiert erscheint sie als Symbol unten rechts; zum Erweitern anklicken. Bereich und beizubehaltende Inhalte angeben, etwa: „Untertitel dieses Interviews auf Tippfehler prüfen, aber natürliche Formulierungen beibehalten.“",
        ],
        [
          "Vorgang verfolgen und Ergebnis prüfen",
          "Jeder Agentenschritt ist erweiterbar. Je nach Zugriffsmodus wird vor Befehlen oder Änderungen um Genehmigung oder Ablehnung gebeten. Jede Videoänderung erzeugt eine Änderungskarte, direkt rückgängig zu machen.",
        ],
      ],
      tip: "Der Agent verwendet nur Videos im Sitzungsordner (Projektordner oder eigener Arbeitsordner). Beim Senden wird ein dortiges offenes Editorvideo samt Auswahl und Abspielkopf beigefügt. Den Verweis oberhalb der Eingabe entfernen, falls gewünscht.",
      cta: "Agenteneinstellungen öffnen",
    },
    missing: {
      title: "Warum sind keine Untertitel im Bild sichtbar?",
      short: null,
      summary: "Nacheinander Untertitel in Zeitleiste, Abspielkopfposition und Spurschalter prüfen.",
      keywords: "unsichtbar fehlen ausgeblendet deaktiviert leer Untertitel Transkription",
      steps: [
        [
          "Untertitel in der Zeitleiste prüfen",
          "Agenten- oder CLI-Transkription speichert nur ein Transkript und ändert die Zeitleiste nicht. Rechts „Untertitel“ öffnen. Bei „Noch keine Untertitel“ auf „Untertitel erzeugen“ klicken, Datei importieren oder den Agenten um Platzierung in der Zeitleiste bitten.",
        ],
        [
          "Zu einer gesprochenen Zeile springen",
          "In „Untertitel“ auf die Zeilenzeit klicken; der Abspielkopf springt dorthin. Sprachpausen haben keine Untertitel.",
        ],
        [
          "Spur- und Clipschalter prüfen",
          "Spurkopf der Untertitelspur prüfen. Ohne Augensymbol erscheint sie nicht in der Vorschau. Deaktivierte Clips werden ebenfalls übersprungen; Rechtsklick und „Diesen Clip aktivieren“ wählen.",
        ],
      ],
      tip: "Weiter unsichtbar? Untertitel auswählen und Position sowie Farbe unter „Untertiteleigenschaften“ prüfen. Text könnte außerhalb des Bildes oder zu ähnlich zum Hintergrund sein.",
      cta: "Untertitel prüfen",
    },
    model: {
      title: "Transkription oder Erzeugung startet nicht. Was tun?",
      short: null,
      summary: "Zuerst den Grund unter Hintergrundaufgaben prüfen, dann fehlenden Modelldienst einrichten.",
      keywords: "fehlgeschlagen Fehler Transkription transkribieren Sprachsynthese Bilderzeugung Modell Dienst Komponente Netzwerk Aufgabe",
      steps: [
        [
          "Hintergrundaufgaben öffnen",
          "„Hintergrundaufgaben“ links enthält alle Hintergrundaufgaben aus Editor, Home-Workflow, Agent oder CLI. Unter „Details“ zeigt bei Fehler der Titel im roten Kasten den Grund.",
        ],
        [
          "In Details genannten Mangel beheben",
          "Details nennen ursachenabhängig den nächsten Schritt: Komponente installieren, Cloud-Modell einrichten, Standardmodell wählen oder Agenteneinstellungen prüfen.",
        ],
        [
          "Zurückkehren und erneut versuchen",
          "Nach Behebung erneut versuchen: „Untertitel erzeugen“ im Untertitel-Bereich anklicken oder den Agenten erneut einreichen lassen. Bei fehlendem Dienst nennt der Agent zuerst den einzuschaltenden Dienst.",
        ],
      ],
      tip: "Transkription, Sprachsynthese und Bilderzeugung benötigen Modelldienste. Hilfe ist offline lesbar; Cloud-Dienste benötigen Netzwerk.",
      cta: "Modelle anzeigen",
    },
  } as Record<GuideId, GuideText>,
};
